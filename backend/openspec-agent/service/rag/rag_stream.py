import re
from typing import Tuple
from service.rag.rag_reference import parse_chunk

class StreamAccumState:
    def __init__(self, actual: str = "", sanitized: str = "", thoughts: str = ""):
        self.accumulated_actual_content = actual
        self.accumulated_sanitized_content = sanitized
        self.accumulated_thoughts = thoughts
    def update(self, actual: str, sanitized: str, thoughts: str):
        self.accumulated_actual_content = actual
        self.accumulated_sanitized_content = sanitized
        self.accumulated_thoughts = thoughts
    def to_dict(self):
        return {
            "accumulated_actual_content": self.accumulated_actual_content,
            "accumulated_sanitized_content": self.accumulated_sanitized_content,
            "accumulated_thoughts": self.accumulated_thoughts,
        }

def extract_content_and_thoughts(content: str, prev_actual: str = "", prev_thoughts: str = "") -> Tuple[str, str, str, str]:
    think_pattern = r"<think>(.*?)</think>"
    thoughts_matches = re.findall(think_pattern, content, re.DOTALL)
    current_thoughts = "".join(thoughts_matches)
    if prev_thoughts and current_thoughts.startswith(prev_thoughts):
        new_thoughts = current_thoughts[len(prev_thoughts):]
    else:
        new_thoughts = current_thoughts
    actual_content = re.sub(think_pattern, "", content, flags=re.DOTALL)
    if prev_actual:
        prev_actual_clean = re.sub(think_pattern, "", prev_actual, flags=re.DOTALL)
        new_actual = actual_content[len(prev_actual_clean):]
    else:
        new_actual = actual_content
    return new_actual, new_thoughts, actual_content, current_thoughts

def unwrap_markdown_fences(content_full: str) -> str:
    s = str(content_full)
    if s.startswith("\ufeff"):
        s = s.lstrip("\ufeff")
    lines = s.splitlines()
    out = []
    fence_line_pattern = re.compile(r"^\s*```(?:[a-zA-Z0-9_-]+)?\s*$")
    closing_fence_pattern = re.compile(r"^\s*```\s*$")
    for ln in lines:
        st = ln.strip()
        if fence_line_pattern.match(st) or closing_fence_pattern.match(st):
            continue
        out.append(ln)
    return "\n".join(out)

def handle_stream_response(chunk, state: StreamAccumState, session_id: str):
    new_content, new_thoughts, current_actual_content, current_thoughts = extract_content_and_thoughts(
        chunk.content, state.accumulated_actual_content, state.accumulated_thoughts
    )
    sanitized_current = unwrap_markdown_fences(current_actual_content)
    new_text = sanitized_current[len(state.accumulated_sanitized_content):]
    state.update(current_actual_content, sanitized_current, current_thoughts)
    reference_list = []
    chunks_list = []
    if hasattr(chunk, "reference") and chunk.reference:
        reference_list, chunks_list = parse_chunk(chunk)
    return {
        "success": True,
        "text": new_text,
        "session_id": session_id,
        "request_id": chunk.id,
        "finish_reason": None,
        "thoughts": new_thoughts,
        "doc_reference": reference_list,
        "chunk_reference": chunks_list,
    }, state
