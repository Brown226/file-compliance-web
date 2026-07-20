FROM docker.m.daocloud.io/python:3.12-slim
# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1


# Copy the requirements file first for better caching
COPY requirements.txt .
# RUN python -m pip install --no-cache-dir -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/
RUN python -m pip install  -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/

# Copy the application code
COPY . .

# Expose the port the app runs on
EXPOSE 5000

# Command to run the application
# 使用 gunicorn 并增加超时设置，解决长请求超时问题
# 注意：使用 UvicornWorker 而非 UvicornH11Worker，以更好地支持 SSE 长连接流式响应
CMD ["gunicorn", "app:app", "--workers", "5", "--worker-class", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:5000", "--timeout", "1200", "--keep-alive", "120", "--graceful-timeout", "60", "--log-level", "info", "--forwarded-allow-ips", "*"]