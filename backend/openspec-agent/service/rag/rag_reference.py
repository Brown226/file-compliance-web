

def _nan_to_zero(x):
    return 0 if x != x else x

def parse_reference_items(items):
    acc = set()
    chunks = []
    for ref in items or []:
        rag_id = ref.get("document_id") or ref.get("doc_id")
        # xt_doc_id = SynDocument.get_xt_doc_id_by_ragflow_id(rag_id)
        doc_name = ref.get("document_name") or ref.get("doc_name") or ""
        acc.add((xt_doc_id, doc_name))
        sim = _nan_to_zero(ref.get("similarity", 0))
        vec = _nan_to_zero(ref.get("vector_similarity", 0))
        term = _nan_to_zero(ref.get("term_similarity", 0))
        chunks.append({
            "image_id": ref.get("image_id", ""),
            "doc_id": rag_id,
            "doc_name": doc_name,
            "type": ref.get("doc_type", ""),
            "chunk_content": ref.get("content", ""),
            "similarity": sim,
            "vector_similarity": vec,
            "term_similarity": term,
            "positions": ref.get("positions", [])
        })
    doc_reference = [{"doc_id": doc_id, "title": title} for doc_id, title in acc]
    return doc_reference, chunks

def parse_chunk(chunk):
    items = getattr(chunk, "reference", None) or []
    return parse_reference_items(items)
