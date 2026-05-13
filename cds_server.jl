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

# CORS headers — permissive enough for local dev; tighten for production.
# Includes Allow-Methods covering both the actual POST and the preflight
# OPTIONS, plus Max-Age so the browser caches the preflight result and
# doesn't re-issue OPTIONS for every request. Allow-Headers is wide
# (Content-Type plus a wildcard) to head off picky browsers blocking on
# any extra header the UI might add later.
const _CORS = [
    "Access-Control-Allow-Origin"  => "*",
    "Access-Control-Allow-Methods" => "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers" => "Content-Type, Accept, Origin, X-Requested-With",
    "Access-Control-Max-Age"       => "86400",
]

_json_response(status_code::Int, body) = HTTP.Response(
    status_code, [_CORS..., "Content-Type" => "application/json"],
    JSON3.write(body),
)

_text_response(status_code::Int, msg::String) = HTTP.Response(
    status_code, [_CORS..., "Content-Type" => "text/plain"], msg,
)

# Browser preflight handler — return 204 No Content with the CORS headers.
options_handler(_req) = HTTP.Response(204, _CORS)

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

        return _json_response(200, Dict(
            "status" => string(status),
            "detail" => detail,
            "state"  => out_bundle,
        ))
    catch e
        # Any error during parse/fire/serialize bubbles up here. Send a
        # 400 with a useful message rather than crashing the server loop.
        msg = sprint(showerror, e)
        return _text_response(400, "fire failed: $msg")
    end
end

function router(req::HTTP.Request)
    if req.method == "OPTIONS"
        return options_handler(req)
    elseif req.method == "POST" && req.target == "/fire"
        return fire_handler(req)
    elseif req.method == "GET" && req.target == "/"
        return _text_response(200, "Algebraic_CDS rule engine — POST /fire to fire a rule.\n")
    else
        return _text_response(404, "not found: $(req.method) $(req.target)\n")
    end
end

println("Algebraic_CDS server listening on http://localhost:$PORT")
println("  POST /fire  — fire a rule on host state")
HTTP.serve(router, "0.0.0.0", PORT)
