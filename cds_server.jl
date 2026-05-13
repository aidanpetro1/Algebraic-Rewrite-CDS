# cds_server.jl — tiny HTTP server exposing the rule engine to the UI.
#
# One endpoint:
#   POST /fire
#     body: { "rule": <rule Bundle>, "host": <patient Bundle> }
#     returns: { "status": ":fired" | ":no_match" | ":nac_violated" | ":pred_failed",
#                "state": <post-fire patient Bundle> }
#
# Plus an OPTIONS handler for the browser preflight, and CORS headers
# wide enough that the Vite dev server (http://localhost:5173) can hit it.
#
# Requires HTTP.jl. Add it with:
#   julia --project=. -e 'import Pkg; Pkg.add("HTTP")'
#
# Run with:
#   julia --project=. cds_server.jl
# Server listens on http://localhost:8081.

include("fhir_to_rule.jl")
include("fhir_serialize.jl")
include("fhir_parse.jl")

using HTTP
using JSON3

# PORT is injected by the host (Railway, Fly, etc.) via the environment.
# Local dev falls back to 8081, which matches the UI's default VITE_CDS_URL.
const PORT = parse(Int, get(ENV, "PORT", "8081"))

# Origin-aware CORS. We allow-list specific origins instead of `*` so a
# random third-party page can't pose as the UI and call /fire on the
# user's behalf. The Origin header from the request is echoed back when
# it's in the allow set; otherwise the header is empty and the browser
# blocks the response. `Vary: Origin` is important — without it, a CDN
# could cache one origin's CORS response and hand it to a different one.
#
# Production is the deployed Pages domain; localhost variants are kept so
# `npm run dev` (Vite default 5173) and `npm run preview` (default 4173)
# keep working without a separate config flag.
# Exact origins (production hostnames + local dev ports). Add new
# production URLs here as they come online (custom domain, alt deploys).
const _ALLOWED_ORIGINS = Set([
    "https://algebraic-cds.aidanpetrovich.workers.dev",
    "https://algebraic-cds.pages.dev",
    "http://localhost:5173",
    "http://localhost:4173",
])

# Pattern matching for Cloudflare preview deployments. Each preview build
# gets a subdomain like `<hash>.algebraic-cds.aidanpetrovich.workers.dev`
# or `<branch>.algebraic-cds.pages.dev`. Without this, opening a preview
# URL from the deployments list silently fails CORS.
const _ALLOWED_ORIGIN_PATTERNS = [
    r"^https://[a-z0-9-]+\.algebraic-cds\.aidanpetrovich\.workers\.dev$",
    r"^https://[a-z0-9-]+\.algebraic-cds\.pages\.dev$",
]

_origin_allowed(origin::AbstractString) =
    origin in _ALLOWED_ORIGINS ||
    any(p -> occursin(p, origin), _ALLOWED_ORIGIN_PATTERNS)

function _cors_headers(req::HTTP.Request)
    origin = HTTP.header(req, "Origin", "")
    allow = _origin_allowed(origin) ? origin : ""
    [
        "Access-Control-Allow-Origin"  => allow,
        "Vary"                         => "Origin",
        "Access-Control-Allow-Methods" => "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers" => "Content-Type, Accept, Origin, X-Requested-With",
        "Access-Control-Max-Age"       => "86400",
    ]
end

_json_response(req::HTTP.Request, status_code::Int, body) = HTTP.Response(
    status_code,
    [_cors_headers(req)..., "Content-Type" => "application/json"],
    JSON3.write(body),
)

_text_response(req::HTTP.Request, status_code::Int, msg::String) = HTTP.Response(
    status_code,
    [_cors_headers(req)..., "Content-Type" => "text/plain"],
    msg,
)

# Browser preflight handler — return 204 No Content with the CORS headers
# for this specific request's Origin.
options_handler(req::HTTP.Request) = HTTP.Response(204, _cors_headers(req))

function fire_handler(req::HTTP.Request)
    try
        body = JSON3.read(String(req.body), Dict)
        rule_bundle = body["rule"]
        host_bundle = body["host"]

        # Parse both sides into ACSets / a CDSRule.
        rule = fhir_to_rule(rule_bundle)
        state_pre = fhir_to_acset(host_bundle)

        # Fire. The engine returns (status::Symbol, state, detail). On
        # non-fire statuses (no_match, nac_violated, pred_failed), state
        # is the original (no rewrite) and `detail` is a human-readable
        # description of what blocked it (NAC index, predicate summary).
        status, state_post, detail = fire(rule, state_pre)

        # Serialize the post-fire state back to a patient Bundle so the UI
        # can display it. Even on non-fire statuses we send something back
        # so the UI's display logic stays uniform.
        out_bundle = acset_to_fhir(state_post)

        return _json_response(req, 200, Dict(
            "status" => string(status),
            "detail" => detail,
            "state"  => out_bundle,
        ))
    catch e
        # Any error during parse/fire/serialize bubbles up here. Send a
        # 400 with a useful message rather than crashing the server loop.
        msg = sprint(showerror, e)
        return _text_response(req, 400, "fire failed: $msg")
    end
end

function router(req::HTTP.Request)
    if req.method == "OPTIONS"
        return options_handler(req)
    elseif req.method == "POST" && req.target == "/fire"
        return fire_handler(req)
    elseif req.method == "GET" && req.target == "/"
        return _text_response(req, 200, "Algebraic_CDS rule engine — POST /fire to fire a rule.\n")
    else
        return _text_response(req, 404, "not found: $(req.method) $(req.target)\n")
    end
end

println("Algebraic_CDS server listening on http://localhost:$PORT")
println("  POST /fire  — fire a rule on host state")
HTTP.serve(router, "0.0.0.0", PORT)
