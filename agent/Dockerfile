FROM python:3.12-slim

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agent.py .

# Non-root user for container security
RUN useradd -r -u 1001 agent && chown -R agent:agent /app
USER agent

EXPOSE 9977
HEALTHCHECK --interval=30s --timeout=5s \
  CMD curl -sf http://localhost:9977/v1/health || exit 1

CMD ["python", "agent.py"]
