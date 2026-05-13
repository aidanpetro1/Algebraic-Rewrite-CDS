# Dockerfile — Julia engine image for Railway (or any container host).
#
# Build:   docker build -t algebraic-cds .
# Run:     docker run --rm -p 8081:8081 algebraic-cds
# Railway: detected automatically when this file sits at the repo root.
#
# Heads-up: Julia precompiles Catlab + AlgebraicRewriting during image build,
# which is slow (~5–10 min). That's the price for sub-second startup at runtime.

FROM julia:1.10-bookworm

WORKDIR /app

# Step 1: bring in the package manifests first so Docker can cache the
# Pkg.instantiate layer across rebuilds when only .jl source changes.
COPY Project.toml Manifest.toml ./

RUN julia --project=. -e 'using Pkg; Pkg.instantiate(); Pkg.precompile()'

# Step 2: copy the engine source. Tests and design notes are intentionally
# excluded via .dockerignore to keep the image small and rebuilds fast.
COPY *.jl ./

# Railway assigns $PORT dynamically; locally we fall back to 8081. The
# server reads ENV["PORT"] (see cds_server.jl) so EXPOSE is informational.
EXPOSE 8081

CMD ["julia", "--project=.", "cds_server.jl"]
