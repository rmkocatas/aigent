#!/usr/bin/env python3
"""
OpenClaw Deploy — Fine-Tuning Script

Trains a LoRA adapter on top of a base model using the best available backend,
merges the adapter, and converts the result to GGUF format.

Progress is reported via JSON lines on stdout so the Node.js orchestrator can
parse them.
"""

import argparse
import json
import os
import sys
import time
import subprocess
import shutil
from pathlib import Path


# ---------------------------------------------------------------------------
# Progress helpers
# ---------------------------------------------------------------------------

def emit(status: str, progress: float | None = None, **kwargs):
    """Print a JSON progress line to stdout."""
    msg = {"status": status}
    if progress is not None:
        msg["progress"] = round(progress, 3)
    msg.update(kwargs)
    print(json.dumps(msg), flush=True)


def emit_error(message: str):
    emit("error", error=message)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_training_data(data_path: str) -> list[dict]:
    """Load JSONL training data (each line: {prompt, response})."""
    entries: list[dict] = []
    with open(data_path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if "prompt" in entry and "response" in entry:
                    entries.append(entry)
            except json.JSONDecodeError:
                emit("warning", message=f"Skipping malformed line {line_num}")
    return entries


def format_for_training(entries: list[dict]) -> list[dict]:
    """Convert entries into the chat-ML format expected by most trainers."""
    formatted = []
    for entry in entries:
        formatted.append({
            "messages": [
                {"role": "user", "content": entry["prompt"]},
                {"role": "assistant", "content": entry["response"]},
            ]
        })
    return formatted


# ---------------------------------------------------------------------------
# Backend: Unsloth (NVIDIA GPU preferred)
# ---------------------------------------------------------------------------

def train_unsloth(
    base_model: str,
    dataset: list[dict],
    output_dir: str,
    lora_rank: int,
    epochs: int,
    batch_size: int,
    lr: float,
):
    from unsloth import FastLanguageModel
    from trl import SFTTrainer
    from transformers import TrainingArguments
    import torch

    emit("loading_model", 0.05)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=base_model,
        max_seq_length=2048,
        dtype=None,  # auto-detect
        load_in_4bit=True,
    )

    emit("applying_lora", 0.10)
    model = FastLanguageModel.get_peft_model(
        model,
        r=lora_rank,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        lora_alpha=lora_rank * 2,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
    )

    emit("preparing_data", 0.15)

    def formatting_func(examples):
        texts = []
        for msgs in examples["messages"]:
            text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
            texts.append(text)
        return {"text": texts}

    from datasets import Dataset
    ds = Dataset.from_list(dataset)
    ds = ds.map(formatting_func, batched=True)

    training_args = TrainingArguments(
        output_dir=os.path.join(output_dir, "checkpoints"),
        per_device_train_batch_size=batch_size,
        num_train_epochs=epochs,
        learning_rate=lr,
        fp16=torch.cuda.is_available(),
        logging_steps=1,
        save_strategy="epoch",
        warmup_ratio=0.05,
        lr_scheduler_type="cosine",
        optim="adamw_8bit",
    )

    class ProgressCallback:
        def on_log(self, args, state, control, logs=None, **kwargs):
            if state.global_step > 0 and state.max_steps > 0:
                pct = 0.20 + 0.60 * (state.global_step / state.max_steps)
                loss = logs.get("loss", 0) if logs else 0
                epoch = logs.get("epoch", 0) if logs else 0
                emit("training", pct, epoch=epoch, loss=loss)

    emit("training", 0.20)
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=ds,
        dataset_text_field="text",
        max_seq_length=2048,
        args=training_args,
        callbacks=[ProgressCallback()],
    )
    trainer.train()

    emit("saving_adapter", 0.82)
    adapter_dir = os.path.join(output_dir, "adapter")
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)

    emit("merging_adapter", 0.85)
    merged_dir = os.path.join(output_dir, "merged")
    model.save_pretrained_merged(merged_dir, tokenizer, save_method="merged_16bit")

    return merged_dir


# ---------------------------------------------------------------------------
# Backend: MLX (Apple Silicon preferred)
# ---------------------------------------------------------------------------

def train_mlx(
    base_model: str,
    dataset: list[dict],
    output_dir: str,
    lora_rank: int,
    epochs: int,
    batch_size: int,
    lr: float,
):
    import mlx.core as mx  # noqa: F401 — validates MLX availability
    from mlx_lm import load as mlx_load
    from mlx_lm import generate  # noqa: F401

    emit("loading_model", 0.05)

    # Prepare data files that mlx-lm expects
    data_dir = os.path.join(output_dir, "mlx_data")
    os.makedirs(data_dir, exist_ok=True)

    # mlx-lm expects train.jsonl with {text} or {messages} format
    train_path = os.path.join(data_dir, "train.jsonl")
    with open(train_path, "w", encoding="utf-8") as f:
        for item in dataset:
            f.write(json.dumps(item) + "\n")

    # Write a small validation split (last 10% or at least 1)
    split = max(1, len(dataset) // 10)
    valid_path = os.path.join(data_dir, "valid.jsonl")
    with open(valid_path, "w", encoding="utf-8") as f:
        for item in dataset[-split:]:
            f.write(json.dumps(item) + "\n")

    emit("training", 0.15)

    adapter_dir = os.path.join(output_dir, "adapter")
    os.makedirs(adapter_dir, exist_ok=True)

    # Use mlx_lm.lora CLI for training
    cmd = [
        sys.executable, "-m", "mlx_lm.lora",
        "--model", base_model,
        "--data", data_dir,
        "--adapter-path", adapter_dir,
        "--train",
        "--batch-size", str(batch_size),
        "--num-layers", str(lora_rank),
        "--iters", str(epochs * max(1, len(dataset) // batch_size)),
        "--learning-rate", str(lr),
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        emit_error(f"MLX training failed: {proc.stderr[:500]}")

    emit("training", 0.80)

    # Fuse adapter into the model
    emit("merging_adapter", 0.85)
    merged_dir = os.path.join(output_dir, "merged")
    fuse_cmd = [
        sys.executable, "-m", "mlx_lm.fuse",
        "--model", base_model,
        "--adapter-path", adapter_dir,
        "--save-path", merged_dir,
    ]
    proc = subprocess.run(fuse_cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        emit_error(f"MLX fuse failed: {proc.stderr[:500]}")

    return merged_dir


# ---------------------------------------------------------------------------
# Backend: HuggingFace Transformers (fallback)
# ---------------------------------------------------------------------------

def train_transformers(
    base_model: str,
    dataset: list[dict],
    output_dir: str,
    lora_rank: int,
    epochs: int,
    batch_size: int,
    lr: float,
):
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        TrainingArguments,
        Trainer,
    )
    from peft import LoraConfig, get_peft_model
    from datasets import Dataset
    import torch

    emit("loading_model", 0.05)

    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        device_map="auto" if torch.cuda.is_available() else None,
        trust_remote_code=True,
    )

    emit("applying_lora", 0.10)
    lora_config = LoraConfig(
        r=lora_rank,
        lora_alpha=lora_rank * 2,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    emit("preparing_data", 0.15)

    def tokenize(example):
        msgs = example["messages"]
        text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
        tokens = tokenizer(text, truncation=True, max_length=2048, padding="max_length")
        tokens["labels"] = tokens["input_ids"].copy()
        return tokens

    ds = Dataset.from_list(dataset)
    ds = ds.map(tokenize, remove_columns=ds.column_names)

    training_args = TrainingArguments(
        output_dir=os.path.join(output_dir, "checkpoints"),
        per_device_train_batch_size=batch_size,
        num_train_epochs=epochs,
        learning_rate=lr,
        fp16=torch.cuda.is_available(),
        logging_steps=1,
        save_strategy="epoch",
        warmup_ratio=0.05,
        lr_scheduler_type="cosine",
    )

    class ProgressCallback:
        def on_log(self, args, state, control, logs=None, **kwargs):
            if state.global_step > 0 and state.max_steps > 0:
                pct = 0.20 + 0.60 * (state.global_step / state.max_steps)
                loss = logs.get("loss", 0) if logs else 0
                epoch = logs.get("epoch", 0) if logs else 0
                emit("training", pct, epoch=epoch, loss=loss)

    emit("training", 0.20)
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=ds,
        callbacks=[ProgressCallback()],
    )
    trainer.train()

    emit("saving_adapter", 0.82)
    adapter_dir = os.path.join(output_dir, "adapter")
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)

    emit("merging_adapter", 0.85)
    from peft import PeftModel
    base_model_reloaded = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        device_map="auto" if torch.cuda.is_available() else None,
        trust_remote_code=True,
    )
    merged_model = PeftModel.from_pretrained(base_model_reloaded, adapter_dir)
    merged_model = merged_model.merge_and_unload()

    merged_dir = os.path.join(output_dir, "merged")
    os.makedirs(merged_dir, exist_ok=True)
    merged_model.save_pretrained(merged_dir)
    tokenizer.save_pretrained(merged_dir)

    return merged_dir


# ---------------------------------------------------------------------------
# GGUF conversion
# ---------------------------------------------------------------------------

def convert_to_gguf(merged_dir: str, output_dir: str, model_name: str) -> str:
    """
    Convert merged HuggingFace model to GGUF using llama.cpp's convert script.
    Returns the path to the resulting GGUF file.
    """
    emit("converting_gguf", 0.90)

    gguf_path = os.path.join(output_dir, f"{model_name}.gguf")

    # Try llama.cpp's convert_hf_to_gguf.py (installed via pip or local)
    convert_scripts = [
        # pip-installed llama-cpp-python sometimes ships the script
        shutil.which("convert_hf_to_gguf"),
        shutil.which("convert-hf-to-gguf"),
    ]

    # Also look for the script via python module
    convert_cmd = None
    for script in convert_scripts:
        if script:
            convert_cmd = [script]
            break

    if convert_cmd is None:
        # Try running as a Python module (llama_cpp may expose it)
        # Fall back to calling the script from the llama.cpp repo if available
        try:
            import llama_cpp
            llama_dir = os.path.dirname(os.path.dirname(llama_cpp.__file__))
            candidate = os.path.join(llama_dir, "convert_hf_to_gguf.py")
            if os.path.isfile(candidate):
                convert_cmd = [sys.executable, candidate]
        except ImportError:
            pass

    if convert_cmd is None:
        # Last resort: look in PATH-adjacent locations
        for name in ["convert_hf_to_gguf.py", "convert-hf-to-gguf.py"]:
            found = shutil.which(name)
            if found:
                convert_cmd = [sys.executable, found]
                break

    if convert_cmd is None:
        emit("warning", message="GGUF conversion script not found; skipping GGUF conversion. "
             "The merged HuggingFace model is available in the output directory.")
        return merged_dir

    cmd = convert_cmd + [
        merged_dir,
        "--outfile", gguf_path,
        "--outtype", "q8_0",
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        emit("warning", message=f"GGUF conversion failed: {proc.stderr[:300]}. "
             "Merged model is still available.")
        return merged_dir

    emit("gguf_complete", 0.95)
    return gguf_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="OpenClaw fine-tuning script")
    parser.add_argument("--data", required=True, help="Path to JSONL training data")
    parser.add_argument("--base-model", required=True, help="HuggingFace model name or path")
    parser.add_argument("--output-dir", required=True, help="Directory for output artifacts")
    parser.add_argument("--lora-rank", type=int, default=16, help="LoRA rank")
    parser.add_argument("--epochs", type=int, default=3, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=4, help="Training batch size")
    parser.add_argument("--lr", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--backend", choices=["unsloth", "mlx", "transformers"], default="transformers",
                        help="Training backend to use")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    # Load data
    emit("loading_data", 0.01)
    entries = load_training_data(args.data)
    if not entries:
        emit_error("No valid training entries found in the data file.")

    dataset = format_for_training(entries)
    emit("data_loaded", 0.03, data_points=len(dataset))

    start_time = time.time()

    # Dispatch to the selected backend
    merged_dir: str
    if args.backend == "unsloth":
        try:
            merged_dir = train_unsloth(
                args.base_model, dataset, args.output_dir,
                args.lora_rank, args.epochs, args.batch_size, args.lr,
            )
        except ImportError as e:
            emit_error(f"Unsloth not available: {e}. Install with: pip install unsloth")
    elif args.backend == "mlx":
        try:
            merged_dir = train_mlx(
                args.base_model, dataset, args.output_dir,
                args.lora_rank, args.epochs, args.batch_size, args.lr,
            )
        except ImportError as e:
            emit_error(f"MLX not available: {e}. Install with: pip install mlx mlx-lm")
    elif args.backend == "transformers":
        try:
            merged_dir = train_transformers(
                args.base_model, dataset, args.output_dir,
                args.lora_rank, args.epochs, args.batch_size, args.lr,
            )
        except ImportError as e:
            emit_error(f"Transformers not available: {e}. Install with: pip install transformers peft datasets")
    else:
        emit_error(f"Unknown backend: {args.backend}")

    # Convert to GGUF
    model_name = args.base_model.replace("/", "_") + "-openclaw-lora"
    output_path = convert_to_gguf(merged_dir, args.output_dir, model_name)

    elapsed = time.time() - start_time
    hours, remainder = divmod(int(elapsed), 3600)
    minutes, seconds = divmod(remainder, 60)
    training_time = f"{hours}h {minutes}m {seconds}s" if hours else f"{minutes}m {seconds}s"

    emit("complete", 1.0,
         model_path=output_path,
         training_time=training_time,
         data_points=len(dataset))


if __name__ == "__main__":
    main()
