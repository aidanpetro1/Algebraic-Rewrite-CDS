# Dockerfile — Julia engine image for Railway (or any container host).
#
# Build:   docker build -t algebraic-cds .
# Run:     docker run --rm -p 8081:8081 algebraic-cds
# Railway: detected automatically when this file sits at the repo root.
#
# Build time is intentionally heavy (~10–15 min) to keep runtime light: all
# Julia compilation happens here, not on first request.
#
# Julia version must match the version the local Manifest.toml was resolved
# against (currently 1.12). Mismatched stdlib versions cause precompile failures.

FROM julia:1.12-bookworm

WORKDIR /app

# Step 1: bring in the package manifests first so Docker can cache the
# Pkg.instantiate layer across rebuilds when only .jl source changes.
COPY Project.toml Manifest.toml ./

# strict=true makes the build fail immediately if any package can't
# precompile, rather than emitting a warning and shipping a half-compiled
# image that re-attempts precompile on every container start.
RUN julia --project=. -e 'using Pkg; Pkg.instantiate(); Pkg.precompile(strict=true)'

# Step 2: copy the engine source.
COPY *.jl ./

# Step 3: warmup pass. Load every file cds_server.jl loads so Julia compiles
# the macros (@present, @acset_type) and method tables once, here, against
# the precompiled package cache. Without this, the first /fire request at
# runtime triggers ~30 s of compilation that often exceeds Railway's
# startup grace period.
RUN julia --project=. -e ' \
        include("fhir_to_rule.jl"); \
        include("fhir_serialize.jl"); \
        include("fhir_parse.jl"); \
        println("warmup successful") \
    '

# Railway assigns $PORT dynamically; locally we fall back to 8081. The
# server reads ENV["PORT"] (see cds_server.jl) so EXPOSE is informational.
EXPOSE 8081

CMD ["julia", "--project=.", "cds_server.jl"]
