FROM debian:bookworm-slim

# Install Chrome + Node.js + Bun
RUN apt-get update && apt-get install -y \
    wget curl gnupg \
    google-chrome-stable \
    --no-install-recommends \
    || (wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - && \
        echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list && \
        apt-get update && apt-get install -y google-chrome-stable) \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app
COPY . .
RUN cd packages/web && bun install && bun run build

ENV PLAYWRIGHT_AVAILABLE=true
ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/google-chrome-stable
ENV PORT=4200

EXPOSE 4200
CMD ["bun", "packages/web/src/server.ts"]
