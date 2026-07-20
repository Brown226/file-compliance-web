#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
诊断 Langfuse 集成问题
检查 handler 属性是否正确传递到 Langfuse
"""
import os
import sys
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

print("=" * 60)
print("Langfuse Integration Diagnosis")
print("=" * 60)

# 1. 检查 Langfuse 版本
print("\n1. Checking Langfuse version...")
try:
    import langfuse
    print(f"[OK] Langfuse version: {langfuse.__version__}")
except Exception as e:
    print(f"[FAIL] Cannot get version: {e}")

# 2. 检查 CallbackHandler 的属性
print("\n2. Checking CallbackHandler attributes...")
try:
    from langfuse.langchain import CallbackHandler
    import inspect

    handler = CallbackHandler()

    # 检查是否有这些私有属性
    print(f"   Has _langfuse_user_id: {hasattr(handler, '_langfuse_user_id')}")
    print(f"   Has _langfuse_session_id: {hasattr(handler, '_langfuse_session_id')}")
    print(f"   Has _langfuse_metadata: {hasattr(handler, '_langfuse_metadata')}")
    print(f"   Has _langfuse_tags: {hasattr(handler, '_langfuse_tags')}")

    # 设置属性
    handler._langfuse_user_id = "test_user"
    handler._langfuse_session_id = "test_session"

    print(f"\n   After setting:")
    print(f"   _langfuse_user_id = {getattr(handler, '_langfuse_user_id', 'NOT SET')}")
    print(f"   _langfuse_session_id = {getattr(handler, '_langfuse_session_id', 'NOT SET')}")

    # 检查 handler 的内部状态
    print(f"\n   Handler internal state:")
    if hasattr(handler, '_langfuse'):
        langfuse_client = handler._langfuse
        print(f"   Langfuse client: {type(langfuse_client)}")

except Exception as e:
    print(f"[FAIL] Error: {e}")
    import traceback
    traceback.print_exc()

# 3. 测试实际的 trace 创建
print("\n3. Testing trace creation with user_id and session_id...")
try:
    from langfuse import Langfuse

    client = Langfuse()

    # 创建一个测试 trace
    trace = client.trace(
        name="diagnosis_test",
        user_id="diagnosis_user_001",
        session_id="diagnosis_session_001",
        metadata={"test": "diagnosis"},
        tags=["diagnosis", "test"]
    )

    print(f"[OK] Trace created: {trace.id}")
    print(f"   User ID: {trace.user_id if hasattr(trace, 'user_id') else 'N/A'}")
    print(f"   Session ID: {trace.session_id if hasattr(trace, 'session_id') else 'N/A'}")

    # 刷新数据
    client.flush()
    print("[OK] Data flushed to Langfuse")

except Exception as e:
    print(f"[FAIL] Error: {e}")
    import traceback
    traceback.print_exc()

# 4. 测试 CallbackHandler 与 LangChain 集成
print("\n4. Testing CallbackHandler with LangChain...")
try:
    from langfuse.langchain import CallbackHandler
    from langchain_core.messages import HumanMessage
    from langchain_community.chat_models import ChatTongyi

    # 创建 handler
    handler = CallbackHandler()
    handler._langfuse_user_id = "langchain_test_user"
    handler._langfuse_session_id = "langchain_test_session"
    handler._langfuse_metadata = {"test": "langchain"}
    handler._langfuse_tags = ["langchain", "test"]

    print(f"[OK] Handler configured")
    print(f"   User ID: {handler._langfuse_user_id}")
    print(f"   Session ID: {handler._langfuse_session_id}")

    # 测试简单的 LLM 调用
    llm = ChatTongyi(model="qwen-turbo", temperature=0)

    response = llm.invoke(
        [HumanMessage(content="Say 'test' in one word")],
        config={"callbacks": [handler]}
    )

    print(f"[OK] LLM invoked successfully")
    print(f"   Response: {response.content[:50]}")

    # 刷新数据
    from langfuse import Langfuse
    client = Langfuse()
    client.flush()
    print("[OK] Data flushed")

except Exception as e:
    print(f"[FAIL] Error: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 60)
print("Diagnosis Complete")
print("=" * 60)

print("\nNext Steps:")
print("1. Check the output above for any errors")
print("2. Wait 30 seconds for Langfuse to process")
print("3. Check Langfuse Dashboard:")
print(f"   URL: {os.getenv('LANGFUSE_BASE_URL')}/project/cmjifp00d0006n607ivxbl0xb")
print("\n4. Look for:")
print("   - Trace: 'diagnosis_test'")
print("   - User: 'diagnosis_user_001' or 'langchain_test_user'")
print("   - Session: 'diagnosis_session_001' or 'langchain_test_session'")
