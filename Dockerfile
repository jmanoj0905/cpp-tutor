# All-in-one distribution image: patched-Valgrind tracer (base) + FastAPI
# backend + built frontend, served by one uvicorn process on :8000.
#
# Two-step build (tracer/Dockerfile stays the single source of truth):
#   docker build -t cpp-tutor-tracer:dev tracer/
#   docker build -t cpp-tutor .
# CI overrides TRACER_IMAGE with a per-arch registry ref because buildx's
# container driver cannot see daemon-local tags.
ARG TRACER_IMAGE=cpp-tutor-tracer:dev

# ── frontend build ───────────────────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
# Empty VITE_API => fetch("/api/trace") relative => same-origin backend.
ENV VITE_API=""
RUN npm run build

# ── fetch standalone CPython (needs modern TLS; final stage is 14.04) ──
FROM ubuntu:24.04 AS pyfetch
RUN apt-get update && apt-get install -y curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ARG TARGETARCH
ARG PBS_RELEASE=20240224
ARG PBS_PYTHON=3.11.8
RUN case "$TARGETARCH" in \
      amd64) PBS_ARCH=x86_64 ;; \
      arm64) PBS_ARCH=aarch64 ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/python.tgz \
      "https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/cpython-${PBS_PYTHON}+${PBS_RELEASE}-${PBS_ARCH}-unknown-linux-gnu-install_only.tar.gz" \
 && mkdir -p /opt && tar -xzf /tmp/python.tgz -C /opt   # => /opt/python

# ── final image: tracer base + python3 + backend + frontend dist ──
FROM ${TRACER_IMAGE}
# python-build-standalone targets glibc 2.17+; 14.04 has 2.19, and it bundles
# its own OpenSSL, so pip TLS works despite the ancient system openssl.
COPY --from=pyfetch /opt/python /opt/python
RUN /opt/python/bin/pip3 install --no-cache-dir \
    "fastapi>=0.110" "uvicorn>=0.29" "pydantic>=2.6"
COPY backend/app /opt/cpp-tutor/app
COPY --from=frontend /src/dist /opt/cpp-tutor/static
ENV CPP_TUTOR_TRACER=local \
    CPP_TUTOR_STATIC=/opt/cpp-tutor/static
WORKDIR /opt/cpp-tutor
# netuser exists in the tracer base and owns /opt/tracer scratch space.
USER netuser
EXPOSE 8000
CMD ["/opt/python/bin/uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "8000"]
