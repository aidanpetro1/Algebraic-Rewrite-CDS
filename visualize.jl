# visualize.jl — render schema, compact state, and full state to out/.

include("main.jl")
include("viz_helpers.jl")

save_svg("schema.svg",     schema_view())
save_svg("state.svg",      full_view(state))
save_svg("state_full.svg", everything_view(state))
