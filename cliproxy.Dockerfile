FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download the latest CLIProxyAPI release for Linux
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then BINARY="cli-proxy-api-linux-amd64"; \
    elif [ "$ARCH" = "arm64" ]; then BINARY="cli-proxy-api-linux-arm64"; \
    else echo "Unsupported architecture: $ARCH" && exit 1; fi && \
    LATEST=$(curl -sL -o /dev/null -w '%{url_effective}' https://github.com/router-for-me/CLIProxyAPI/releases/latest | grep -o '[^/]*$') && \
    curl -sL "https://github.com/router-for-me/CLIProxyAPI/releases/download/${LATEST}/${BINARY}" -o cli-proxy-api && \
    chmod +x cli-proxy-api

COPY cliproxy-config.yaml /app/config.yaml

EXPOSE 8317

CMD ["./cli-proxy-api"]
