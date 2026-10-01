FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Keep the container running for manual execution
# This allows us to exec into the container and run scripts, matching the "worker/CLI" architecture.
CMD ["tail", "-f", "/dev/null"]
