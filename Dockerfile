FROM rust:1.96-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin jacare
WORKDIR /app
COPY --from=builder /app/target/release/jacare-cloud /usr/local/bin/jacare-cloud
COPY dashboard-v1 ./dashboard-v1
RUN mkdir -p /var/lib/jacare-cloud && chown -R jacare:jacare /var/lib/jacare-cloud
USER jacare
ENV JACARE_BIND=0.0.0.0:8080 \
    JACARE_STATIC_DIR=/app/dashboard-v1 \
    JACARE_DATA_DIR=/var/lib/jacare-cloud \
    RUST_LOG=jacare_cloud=info,tower_http=info
EXPOSE 8080
VOLUME ["/var/lib/jacare-cloud"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["/usr/local/bin/jacare-cloud", "--healthcheck"]
ENTRYPOINT ["/usr/local/bin/jacare-cloud"]
