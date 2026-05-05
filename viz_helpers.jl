# viz_helpers.jl — shared rendering functions (no side effects at include time).

using Catlab
using Catlab.Graphics.Graphviz:
    run_graphviz, Graph, Subgraph, Node, Edge, Attributes, Statement

const OUT = joinpath(@__DIR__, "out")

# ============================================================================
# Save / schema / state renderers (used by both layers below).
# ============================================================================

function save_svg(name, g)
    path = joinpath(OUT, name)
    mkpath(dirname(path))   # create intermediate subfolders if needed
    isfile(path) && rm(path)
    open(io -> run_graphviz(io, g; format="svg"), path, "w")
    println("wrote $path ($(filesize(path)) bytes)")
end

function _cluster(cname, title, obs, color)
    s = Statement[]
    for o in obs
        push!(s, Node(string(o); label=string(o), shape="box",
                                 style="rounded,filled", fillcolor=color))
    end
    Subgraph("cluster_$cname";
             stmts=s,
             graph_attrs=Attributes(:label=>title, :style=>"dashed", :fontsize=>"11"))
end

function schema_view()
    stmts = Statement[]
    push!(stmts, _cluster("core",  "core clinical entities",
                          [:Observation, :Finding, :Assessment, :Diagnosis, :Problem],
                          "lightsteelblue"))
    push!(stmts, _cluster("assoc", "associated objects",
                          [:Code, :Value, :Status, :Time], "palegreen"))
    push!(stmts, _cluster("attr",  "attribute types",
                          [:StringAttr, :FloatAttr, :TimeAttr], "lightyellow"))
    edges = [
        (:Finding,    "findObs",     :Observation),
        (:Finding,    "findAssm",    :Assessment),
        (:Diagnosis,  "diagAssm",    :Assessment),
        (:Diagnosis,  "diagProb",    :Problem),
        (:Observation, "obsCode",    :Code),
        (:Observation, "obsValue",   :Value),
        (:Observation, "obsStatus",  :Status),
        (:Observation, "obsTime",    :Time),
        (:Problem,     "probCode",   :Code),
        (:Problem,     "probStatus", :Status),
        (:Problem,     "probTime",   :Time),
        (:Assessment,  "assmStatus", :Status),
        (:Assessment,  "assmTime",   :Time),
        (:Code,   "codeSystem",   :StringAttr),
        (:Code,   "codeValue",    :StringAttr),
        (:Code,   "codeDisplay",  :StringAttr),
        (:Value,  "valMagnitude", :FloatAttr),
        (:Value,  "valUnit",      :StringAttr),
        (:Status, "statusCode",   :StringAttr),
        (:Time,   "timeInstant",  :TimeAttr),
    ]
    for (src, hom, tgt) in edges
        push!(stmts, Edge(string(src), string(tgt); label=hom))
    end
    Graph("schema"; prog="dot",
          graph_attrs=Attributes(:rankdir=>"LR", :compound=>"true",
                                  :nodesep=>"0.4", :ranksep=>"0.8",
                                  :fontname=>"Helvetica"),
          node_attrs=Attributes(:fontname=>"Helvetica", :fontsize=>"10"),
          edge_attrs=Attributes(:fontname=>"Helvetica", :fontsize=>"9"),
          stmts=stmts)
end

# Compact view: each Observation/Assessment/Problem as one node; associated
# objects folded into labels. Findings and Diagnoses as junction dots.
function full_view(st)
    stmts = Statement[]
    for o in parts(st, :Observation)
        c, v = st[o, :obsCode],   st[o, :obsValue]
        s, t = st[o, :obsStatus], st[o, :obsTime]
        lbl = "Obs $o\\l" *
              "code: $(st[c, :codeDisplay])\\l" *
              "      $(st[c, :codeSystem])/$(st[c, :codeValue])\\l" *
              "value: $(st[v, :valMagnitude]) $(st[v, :valUnit])\\l" *
              "status: $(st[s, :statusCode])\\l" *
              "time: $(st[t, :timeInstant])\\l"
        push!(stmts, Node("O$o"; label=lbl, shape="box",
                          style="filled", fillcolor="lightblue",
                          fontname="Helvetica", fontsize="10"))
    end
    for a in parts(st, :Assessment)
        s, t = st[a, :assmStatus], st[a, :assmTime]
        lbl = "Assm $a\\l" *
              "status: $(st[s, :statusCode])\\l" *
              "time: $(st[t, :timeInstant])\\l"
        push!(stmts, Node("A$a"; label=lbl, shape="ellipse",
                          style="filled", fillcolor="khaki",
                          fontname="Helvetica", fontsize="10"))
    end
    for p in parts(st, :Problem)
        c, s, t = st[p, :probCode], st[p, :probStatus], st[p, :probTime]
        lbl = "Prob $p\\l" *
              "code: $(st[c, :codeDisplay])\\l" *
              "      $(st[c, :codeSystem])/$(st[c, :codeValue])\\l" *
              "status: $(st[s, :statusCode])\\l" *
              "time: $(st[t, :timeInstant])\\l"
        push!(stmts, Node("P$p"; label=lbl, shape="box",
                          style="filled", fillcolor="lightpink",
                          fontname="Helvetica", fontsize="10"))
    end
    for f in parts(st, :Finding)
        push!(stmts, Node("F$f"; shape="point", width="0.08"))
        push!(stmts, Edge("O$(st[f, :findObs])", "F$f";
                          arrowhead="none", label="findObs",
                          fontsize="8", fontcolor="gray35"))
        push!(stmts, Edge("F$f", "A$(st[f, :findAssm])";
                          label="findAssm", fontsize="8", fontcolor="gray35"))
    end
    for d in parts(st, :Diagnosis)
        push!(stmts, Node("D$d"; shape="point", width="0.08"))
        push!(stmts, Edge("A$(st[d, :diagAssm])", "D$d";
                          arrowhead="none", label="diagAssm",
                          fontsize="8", fontcolor="gray35"))
        push!(stmts, Edge("D$d", "P$(st[d, :diagProb])";
                          label="diagProb", fontsize="8", fontcolor="gray35"))
    end
    Graph("state"; prog="dot",
          graph_attrs=Attributes(:rankdir=>"LR", :nodesep=>"0.5", :ranksep=>"0.8"),
          stmts=stmts)
end

# Exhaustive view: every row of every Ob rendered as its own labeled node.
function everything_view(st)
    stmts = Statement[]
    for o in parts(st, :Observation)
        push!(stmts, Node("O$o"; label="Obs $o", shape="box",
                          style="filled", fillcolor="lightblue"))
    end
    for a in parts(st, :Assessment)
        push!(stmts, Node("A$a"; label="Assm $a", shape="ellipse",
                          style="filled", fillcolor="khaki"))
    end
    for p in parts(st, :Problem)
        push!(stmts, Node("P$p"; label="Prob $p", shape="box",
                          style="filled", fillcolor="lightpink"))
    end
    for c in parts(st, :Code)
        lbl = "Code $c\\l$(st[c, :codeDisplay])\\l$(st[c, :codeSystem])/$(st[c, :codeValue])\\l"
        push!(stmts, Node("C$c"; label=lbl, shape="box", style="filled", fillcolor="palegreen"))
    end
    for v in parts(st, :Value)
        lbl = "Val $v\\l$(st[v, :valMagnitude]) $(st[v, :valUnit])\\l"
        push!(stmts, Node("V$v"; label=lbl, shape="box", style="filled", fillcolor="palegreen"))
    end
    for s in parts(st, :Status)
        lbl = "Status $s\\l$(st[s, :statusCode])\\l"
        push!(stmts, Node("S$s"; label=lbl, shape="box", style="filled", fillcolor="palegreen"))
    end
    for t in parts(st, :Time)
        lbl = "Time $t\\l$(st[t, :timeInstant])\\l"
        push!(stmts, Node("T$t"; label=lbl, shape="box", style="filled", fillcolor="palegreen"))
    end
    for f in parts(st, :Finding)
        push!(stmts, Node("F$f"; shape="point", width="0.1"))
        push!(stmts, Edge("O$(st[f, :findObs])", "F$f";
                          arrowhead="none", label="findObs",
                          fontsize="8", fontcolor="gray35"))
        push!(stmts, Edge("F$f", "A$(st[f, :findAssm])";
                          label="findAssm", fontsize="8", fontcolor="gray35"))
    end
    for d in parts(st, :Diagnosis)
        push!(stmts, Node("D$d"; shape="point", width="0.1"))
        push!(stmts, Edge("A$(st[d, :diagAssm])", "D$d";
                          arrowhead="none", label="diagAssm",
                          fontsize="8", fontcolor="gray35"))
        push!(stmts, Edge("D$d", "P$(st[d, :diagProb])";
                          label="diagProb", fontsize="8", fontcolor="gray35"))
    end
    for o in parts(st, :Observation)
        push!(stmts, Edge("O$o", "C$(st[o, :obsCode])";   label="obsCode"))
        push!(stmts, Edge("O$o", "V$(st[o, :obsValue])";  label="obsValue"))
        push!(stmts, Edge("O$o", "S$(st[o, :obsStatus])"; label="obsStatus"))
        push!(stmts, Edge("O$o", "T$(st[o, :obsTime])";   label="obsTime"))
    end
    for p in parts(st, :Problem)
        push!(stmts, Edge("P$p", "C$(st[p, :probCode])";   label="probCode"))
        push!(stmts, Edge("P$p", "S$(st[p, :probStatus])"; label="probStatus"))
        push!(stmts, Edge("P$p", "T$(st[p, :probTime])";   label="probTime"))
    end
    for a in parts(st, :Assessment)
        push!(stmts, Edge("A$a", "S$(st[a, :assmStatus])"; label="assmStatus"))
        push!(stmts, Edge("A$a", "T$(st[a, :assmTime])";   label="assmTime"))
    end
    Graph("state_full"; prog="dot",
          graph_attrs=Attributes(:rankdir=>"LR", :nodesep=>"0.3", :ranksep=>"0.8",
                                  :fontname=>"Helvetica"),
          node_attrs=Attributes(:fontname=>"Helvetica", :fontsize=>"9"),
          edge_attrs=Attributes(:fontname=>"Helvetica", :fontsize=>"8"),
          stmts=stmts)
end

# ============================================================================
# Detailed / legacy renderers — render every Code/Value/Status/Time slot as
# its own node with attribute values exposed. Used by the ad-hoc demo
# scripts (rule_dm2.jl, vignette_dm2.jl, visualize.jl, main.jl) when a
# full ACSet inspection is the point. The narrative suite uses the
# didactic renderers further down.
# ============================================================================

# Format an attribute value (concrete or AttrVar) for display.
_fmt_attr(x::AttrVar) = "?$(x.val)"
_fmt_attr(x) = string(x)

# Renders one ACSet (L, K, or R) as a Subgraph with IDs prefixed to avoid
# collision when multiple are drawn together. If `detailed=true`, the
# associated-object nodes (Code, Value, Status, Time) carry their attribute
# values in the label; AttrVars display as `?n`.
function _acset_cluster(prefix, title, st, fill; detailed::Bool=false)
    sub = Statement[]
    for o in parts(st, :Observation)
        push!(sub, Node("$(prefix)_O$o"; label="O$o", shape="box",
                        style="filled", fillcolor="lightblue", fontsize="10"))
    end
    for a in parts(st, :Assessment)
        push!(sub, Node("$(prefix)_A$a"; label="A$a", shape="ellipse",
                        style="filled", fillcolor="khaki", fontsize="10"))
    end
    for p in parts(st, :Problem)
        push!(sub, Node("$(prefix)_P$p"; label="P$p", shape="box",
                        style="filled", fillcolor="lightpink", fontsize="10"))
    end
    for c in parts(st, :Code)
        lbl = detailed ?
            "C$c\\l$(_fmt_attr(st[c, :codeDisplay]))\\l" *
            "$(_fmt_attr(st[c, :codeSystem]))/$(_fmt_attr(st[c, :codeValue]))\\l" :
            "C$c"
        push!(sub, Node("$(prefix)_C$c"; label=lbl, shape="box",
                        style="filled", fillcolor="palegreen", fontsize="9"))
    end
    for v in parts(st, :Value)
        lbl = detailed ?
            "V$v\\l$(_fmt_attr(st[v, :valMagnitude])) $(_fmt_attr(st[v, :valUnit]))\\l" :
            "V$v"
        push!(sub, Node("$(prefix)_V$v"; label=lbl, shape="box",
                        style="filled", fillcolor="palegreen", fontsize="9"))
    end
    for s in parts(st, :Status)
        lbl = detailed ?
            "S$s\\l$(_fmt_attr(st[s, :statusCode]))\\l" :
            "S$s"
        push!(sub, Node("$(prefix)_S$s"; label=lbl, shape="box",
                        style="filled", fillcolor="palegreen", fontsize="9"))
    end
    for t in parts(st, :Time)
        lbl = detailed ?
            "T$t\\l$(_fmt_attr(st[t, :timeInstant]))\\l" :
            "T$t"
        push!(sub, Node("$(prefix)_T$t"; label=lbl, shape="box",
                        style="filled", fillcolor="palegreen", fontsize="9"))
    end
    for f in parts(st, :Finding)
        push!(sub, Node("$(prefix)_F$f"; shape="point", width="0.06"))
        push!(sub, Edge("$(prefix)_O$(st[f, :findObs])", "$(prefix)_F$f";
                        arrowhead="none", label="findObs",
                        fontsize="7", fontcolor="gray35"))
        push!(sub, Edge("$(prefix)_F$f", "$(prefix)_A$(st[f, :findAssm])";
                        label="findAssm", fontsize="7", fontcolor="gray35"))
    end
    for d in parts(st, :Diagnosis)
        push!(sub, Node("$(prefix)_D$d"; shape="point", width="0.06"))
        push!(sub, Edge("$(prefix)_A$(st[d, :diagAssm])", "$(prefix)_D$d";
                        arrowhead="none", label="diagAssm",
                        fontsize="7", fontcolor="gray35"))
        push!(sub, Edge("$(prefix)_D$d", "$(prefix)_P$(st[d, :diagProb])";
                        label="diagProb", fontsize="7", fontcolor="gray35"))
    end
    for o in parts(st, :Observation)
        push!(sub, Edge("$(prefix)_O$o", "$(prefix)_C$(st[o, :obsCode])"; color="gray50"))
        push!(sub, Edge("$(prefix)_O$o", "$(prefix)_V$(st[o, :obsValue])"; color="gray50"))
        push!(sub, Edge("$(prefix)_O$o", "$(prefix)_S$(st[o, :obsStatus])"; color="gray50"))
        push!(sub, Edge("$(prefix)_O$o", "$(prefix)_T$(st[o, :obsTime])"; color="gray50"))
    end
    for p in parts(st, :Problem)
        push!(sub, Edge("$(prefix)_P$p", "$(prefix)_C$(st[p, :probCode])"; color="gray50"))
        push!(sub, Edge("$(prefix)_P$p", "$(prefix)_S$(st[p, :probStatus])"; color="gray50"))
        push!(sub, Edge("$(prefix)_P$p", "$(prefix)_T$(st[p, :probTime])"; color="gray50"))
    end
    for a in parts(st, :Assessment)
        push!(sub, Edge("$(prefix)_A$a", "$(prefix)_S$(st[a, :assmStatus])"; color="gray50"))
        push!(sub, Edge("$(prefix)_A$a", "$(prefix)_T$(st[a, :assmTime])"; color="gray50"))
    end
    Subgraph("cluster_$prefix";
             stmts=sub,
             graph_attrs=Attributes(:label=>title, :style=>"filled",
                                     :fillcolor=>fill, :fontsize=>"13"))
end

# Span visualization: L ← K → R as three clusters with dashed morphism
# edges (blue = l: K→L, red = r: K→R) across every Ob type. When
# `detailed=true`, associated-object nodes carry their data in the label.
# Takes the morphisms l, r directly so it works for spans that can't be
# packaged into an AlgebraicRewriting `Rule` — e.g. the design-only
# DM2-resolve rule whose r-AttrType component is non-monic.
function span_view(l, r; detailed::Bool=false)
    L = codom(l)
    K = dom(l)
    R = codom(r)

    stmts = Statement[]
    push!(stmts, _acset_cluster("L", "L  (pattern)",     L, "aliceblue"; detailed=detailed))
    push!(stmts, _acset_cluster("K", "K  (invariant)",   K, "cornsilk";  detailed=detailed))
    push!(stmts, _acset_cluster("R", "R  (replacement)", R, "mistyrose"; detailed=detailed))

    short = Dict(:Observation=>"O", :Assessment=>"A", :Problem=>"P",
                 :Finding=>"F", :Diagnosis=>"D", :Code=>"C", :Value=>"V",
                 :Status=>"S", :Time=>"T")
    for (ob, letter) in short
        nparts(K, ob) > 0 || continue
        for k in parts(K, ob)
            push!(stmts, Edge("K_$letter$k", "L_$letter$(l[ob](k))";
                              style="dashed", color="blue", constraint="false"))
            push!(stmts, Edge("K_$letter$k", "R_$letter$(r[ob](k))";
                              style="dashed", color="red",  constraint="false"))
        end
    end

    # Force horizontal layout L — K — R by adding invisible anchor edges.
    anchor_ob = first(ob for ob in keys(short)
                        if nparts(L, ob) > 0 && nparts(K, ob) > 0 && nparts(R, ob) > 0)
    letter = short[anchor_ob]
    push!(stmts, Edge("L_$letter$(first(parts(L, anchor_ob)))",
                      "K_$letter$(first(parts(K, anchor_ob)))"; style="invis"))
    push!(stmts, Edge("K_$letter$(first(parts(K, anchor_ob)))",
                      "R_$letter$(first(parts(R, anchor_ob)))"; style="invis"))

    Graph("rule"; prog="dot",
          graph_attrs=Attributes(:rankdir=>"LR", :compound=>"true",
                                  :fontname=>"Helvetica", :nodesep=>"0.3"),
          node_attrs=Attributes(:fontname=>"Helvetica"),
          edge_attrs=Attributes(:fontname=>"Helvetica", :fontsize=>"8"),
          stmts=stmts)
end

# Convenience wrappers for code that already has a Rule object.
rule_view(rule; detailed::Bool=false)  = span_view(rule.L, rule.R; detailed=detailed)
rule_view_detailed(rule)               = rule_view(rule; detailed=true)
span_view_detailed(l, r)               = span_view(l, r; detailed=true)

# Before/after combined view: two clusters side-by-side in a single SVG,
# with an invisible anchor forcing horizontal layout.
function before_after_view(before, after; detailed::Bool=false)
    stmts = Statement[]
    push!(stmts, _acset_cluster("B", "before", before, "aliceblue"; detailed=detailed))
    push!(stmts, _acset_cluster("A", "after",  after,  "honeydew";  detailed=detailed))
    if nparts(before, :Observation) > 0 && nparts(after, :Observation) > 0
        b = first(parts(before, :Observation))
        a = first(parts(after,  :Observation))
        push!(stmts, Edge("B_O$b", "A_O$a"; style="invis"))
    end
    Graph("before_after"; prog="dot",
          graph_attrs=Attributes(:rankdir=>"LR", :compound=>"true",
                                  :fontname=>"Helvetica", :nodesep=>"0.3"),
          node_attrs=Attributes(:fontname=>"Helvetica"),
          edge_attrs=Attributes(:fontname=>"Helvetica", :fontsize=>"8"),
          stmts=stmts)
end

before_after_view_detailed(before, after) = before_after_view(before, after; detailed=true)

# Render a rule's attribute predicates as a note-shaped text block.
# Callers pass the rule's preds list (may be AttrPredicate structs or raw
# closures); describe() handles both cases.
function predicates_view(preds::AbstractVector)
    stmts = Statement[]
    if isempty(preds)
        push!(stmts, Node("preds"; label="(no predicates)", shape="note",
                                   style="filled", fillcolor="lightyellow",
                                   fontname="Helvetica", fontsize="10"))
    else
        lines = [describe(p) for p in preds]
        label = "Attribute predicates\\l\\l" * join(lines, "\\l") * "\\l"
        push!(stmts, Node("preds"; label=label, shape="note",
                                   style="filled", fillcolor="lightyellow",
                                   fontname="Helvetica", fontsize="10"))
    end
    Graph("preds"; stmts=stmts,
          graph_attrs=Attributes(:fontname=>"Helvetica"))
end

# Short symbol used by Ob → letter mappings throughout the viz layer.
const _OB_LETTER = Dict(:Observation=>"O", :Assessment=>"A", :Problem=>"P",
                        :Finding=>"F", :Diagnosis=>"D", :Code=>"C",
                        :Value=>"V", :Status=>"S", :Time=>"T")

# ============================================================================
# Didactic renderers — strip schema bookkeeping (Code/Value/Status/Time as
# separate nodes), drop AttrVars from labels (so the difference between L,
# K, R shows up as which information appears), and use cluster-edge anchors
# for clean horizontal layout. These are the renderers the viz_suite uses.
# ============================================================================

# Curated short names so rule patterns (where codeDisplay is an AttrVar)
# still render with a recognizable label rather than a code identifier.
# Edit this table when new clinical codes show up in rules or scenarios.
const _CODE_NAME = Dict(
    ("http://loinc.org",       "4548-4")    => "HbA1c",
    ("http://loinc.org",       "1558-6")    => "Fasting glucose",
    ("http://loinc.org",       "8480-6")    => "Systolic BP",
    ("http://loinc.org",       "39156-5")   => "BMI",
    ("http://loinc.org",       "2093-3")    => "Total cholesterol",
    ("http://snomed.info/sct", "44054006")  => "DM2",
    ("http://snomed.info/sct", "59621000")  => "Hypertension",
    ("http://snomed.info/sct", "414915002") => "Obesity",
    ("http://snomed.info/sct", "55822004")  => "Hyperlipidemia",
)

# Returns string for literal values, nothing for AttrVars / missing.
_lit(x::AttrVar) = nothing
_lit(::Nothing)  = nothing
_lit(x)          = string(x)

# Short human-readable name for a Code part. Prefers the curated lookup
# above (so verbose displays collapse to "DM2" / "HbA1c"). Falls back to
# whatever codeDisplay literal is on the part, then to the codeValue.
function _code_label(st, c)
    cv  = _lit(st[c, :codeValue])
    sys = _lit(st[c, :codeSystem])
    if cv !== nothing && sys !== nothing && haskey(_CODE_NAME, (sys, cv))
        return _CODE_NAME[(sys, cv)]
    end
    cd  = _lit(st[c, :codeDisplay])
    cd === nothing || return cd
    cv === nothing || return cv
    "?"
end

# Single-line label. With a literal value: "Obs 1: HbA1c = 9.8 %". With an
# AttrVar value and a matching predicate in `predicates`: "Obs 1: HbA1c
# [< 5.7]" — the predicate's op + threshold render in place of the absent
# concrete value, so the rule's trigger condition reads off directly. With
# no value and no predicate: "Obs 1: HbA1c".
function _didactic_obs_label(st, o; predicates=[])
    name = _code_label(st, st[o, :obsCode])
    v    = st[o, :obsValue]
    vm   = _lit(st[v, :valMagnitude])
    vu   = _lit(st[v, :valUnit])
    label = "Obs $o: $name"
    if vm !== nothing
        label *= vu === nothing ? " = $vm" : " = $vm $vu"
    else
        # No literal value — see if any predicate constrains this Obs.
        c   = st[o, :obsCode]
        sys = _lit(st[c, :codeSystem])
        cv  = _lit(st[c, :codeValue])
        if sys !== nothing && cv !== nothing
            for p in predicates
                hasproperty(p, :code_system) && hasproperty(p, :code_value) &&
                    hasproperty(p, :op) && hasproperty(p, :threshold) || continue
                p.code_system == sys && p.code_value == cv || continue
                label *= " [$(nameof(p.op)) $(p.threshold)]"
                break
            end
        end
    end
    label
end

# Single-line label: "Prob 1: DM2 (active)" when status is literal,
# "Prob 1: DM2" otherwise.
function _didactic_prob_label(st, p)
    name = _code_label(st, st[p, :probCode])
    sc   = _lit(st[st[p, :probStatus], :statusCode])
    label = "Prob $p: $name"
    sc === nothing || (label *= " ($sc)")
    label
end

# "Assm 1" or "Assm 1 (completed)".
function _didactic_assm_label(st, a)
    sc = _lit(st[st[a, :assmStatus], :statusCode])
    label = "Assm $a"
    sc === nothing || (label *= " ($sc)")
    label
end

# Build statements for one ACSet, with optional ID prefix for cluster use.
# Predicates (if any) are folded into Obs labels whose value is an AttrVar.
function _didactic_state_stmts(prefix, st; predicates=[])
    pid(letter, n) = isempty(prefix) ? "$letter$n" : "$(prefix)_$letter$n"
    stmts = Statement[]
    for o in parts(st, :Observation)
        push!(stmts, Node(pid("O", o);
                          label=_didactic_obs_label(st, o; predicates=predicates),
                          shape="box", style="filled", fillcolor="lightblue",
                          fontname="Helvetica", fontsize="10"))
    end
    for a in parts(st, :Assessment)
        push!(stmts, Node(pid("A", a); label=_didactic_assm_label(st, a),
                          shape="ellipse", style="filled", fillcolor="khaki",
                          fontname="Helvetica", fontsize="10"))
    end
    for p in parts(st, :Problem)
        push!(stmts, Node(pid("P", p); label=_didactic_prob_label(st, p),
                          shape="box", style="filled", fillcolor="lightpink",
                          fontname="Helvetica", fontsize="10"))
    end
    for f in parts(st, :Finding)
        push!(stmts, Node(pid("F", f); shape="point", width="0.07"))
        push!(stmts, Edge(pid("O", st[f, :findObs]), pid("F", f);
                          arrowhead="none", label="findObs",
                          fontsize="8", fontcolor="gray35"))
        push!(stmts, Edge(pid("F", f), pid("A", st[f, :findAssm]);
                          label="findAssm", fontsize="8", fontcolor="gray35"))
    end
    for d in parts(st, :Diagnosis)
        push!(stmts, Node(pid("D", d); shape="point", width="0.07"))
        push!(stmts, Edge(pid("A", st[d, :diagAssm]), pid("D", d);
                          arrowhead="none", label="diagAssm",
                          fontsize="8", fontcolor="gray35"))
        push!(stmts, Edge(pid("D", d), pid("P", st[d, :diagProb]);
                          label="diagProb", fontsize="8", fontcolor="gray35"))
    end
    stmts
end

# Standalone ACSet rendering (one cluster's worth of nodes, no Subgraph).
function didactic_state_view(st; predicates=[])
    Graph("state"; prog="dot",
          graph_attrs=Attributes(:rankdir=>"LR", :nodesep=>"0.4",
                                  :ranksep=>"0.6", :fontname=>"Helvetica"),
          node_attrs=Attributes(:fontname=>"Helvetica"),
          edge_attrs=Attributes(:fontname=>"Helvetica", :fontsize=>"9"),
          stmts=_didactic_state_stmts("", st; predicates=predicates))
end

function _didactic_cluster(prefix, title, st, fill; predicates=[])
    Subgraph("cluster_$prefix";
             stmts=_didactic_state_stmts(prefix, st; predicates=predicates),
             graph_attrs=Attributes(:label=>title, :style=>"filled",
                                     :fillcolor=>fill, :fontsize=>"12"))
end

# Pick a node ID inside a cluster to anchor inter-cluster edges on.
function _first_anchor(prefix, st)
    for ob in (:Observation, :Problem, :Assessment, :Finding, :Diagnosis)
        nparts(st, ob) > 0 &&
            return "$(prefix)_$(_OB_LETTER[ob])$(first(parts(st, ob)))"
    end
    error("$prefix has no anchorable Ob")
end

# Three-cluster span L ← K → R, horizontally laid out via cluster-edge
# anchors. Optional dashed morphism overlay (blue = l: K → L, red = r: K → R)
# restricted to high-level Obs/Assm/Problem so the picture stays clean.
function didactic_span_view(l, r; show_morphism::Bool=true, predicates=[])
    L = codom(l); K = dom(l); R = codom(r)
    stmts = Statement[]
    # Predicates annotate L only — that's where matching happens.
    push!(stmts, _didactic_cluster("L", "L  (pattern)",
                                   L, "aliceblue"; predicates=predicates))
    push!(stmts, _didactic_cluster("K", "K  (preserved)",   K, "cornsilk"))
    push!(stmts, _didactic_cluster("R", "R  (replacement)", R, "mistyrose"))

    if show_morphism
        for ob in (:Observation, :Assessment, :Problem)
            nparts(K, ob) > 0 || continue
            letter = _OB_LETTER[ob]
            for k in parts(K, ob)
                push!(stmts, Edge("K_$letter$k", "L_$letter$(l[ob](k))";
                                  style="dashed", color="steelblue",
                                  constraint="false"))
                push!(stmts, Edge("K_$letter$k", "R_$letter$(r[ob](k))";
                                  style="dashed", color="indianred",
                                  constraint="false"))
            end
        end
    end

    push!(stmts, Edge(_first_anchor("L", L), _first_anchor("K", K);
                      ltail="cluster_L", lhead="cluster_K", style="invis"))
    push!(stmts, Edge(_first_anchor("K", K), _first_anchor("R", R);
                      ltail="cluster_K", lhead="cluster_R", style="invis"))

    Graph("span"; prog="dot",
          graph_attrs=Attributes(:rankdir=>"LR", :compound=>"true",
                                  :fontname=>"Helvetica",
                                  :nodesep=>"0.4", :ranksep=>"1.2"),
          node_attrs=Attributes(:fontname=>"Helvetica"),
          edge_attrs=Attributes(:fontname=>"Helvetica", :fontsize=>"9"),
          stmts=stmts)
end

# Two-cluster L → N application-condition view (didactic version of nac_view).
function didactic_nac_view(n; positive::Bool=false)
    L = dom(n); N = codom(n)
    stmts = Statement[]
    push!(stmts, _didactic_cluster("L", "L  (precondition pattern)",
                                   L, "aliceblue"))
    push!(stmts, _didactic_cluster("N", positive ?
                                       "N  (required extension)" :
                                       "N  (forbidden extension)",
                                   N, positive ? "honeydew" : "mistyrose"))
    for ob in (:Observation, :Assessment, :Problem)
        nparts(L, ob) > 0 || continue
        letter = _OB_LETTER[ob]
        for k in parts(L, ob)
            push!(stmts, Edge("L_$letter$k", "N_$letter$(n[ob](k))";
                              style="dashed", color="purple",
                              constraint="false"))
        end
    end
    push!(stmts, Edge(_first_anchor("L", L), _first_anchor("N", N);
                      ltail="cluster_L", lhead="cluster_N", style="invis"))
    title = positive ? "Positive application condition (PAC)" :
                       "Negative application condition (NAC)"
    Graph("ac"; prog="dot",
          graph_attrs=Attributes(:rankdir=>"LR", :compound=>"true",
                                  :fontname=>"Helvetica", :nodesep=>"0.4",
                                  :ranksep=>"1.2",
                                  :label=>title, :labelloc=>"t",
                                  :fontsize=>"13"),
          node_attrs=Attributes(:fontname=>"Helvetica"),
          edge_attrs=Attributes(:fontname=>"Helvetica", :fontsize=>"9"),
          stmts=stmts)
end

# Save the rule's span as four files in a subdirectory:
#   <dir>/L.svg, K.svg, R.svg, combined.svg
# Predicates annotate L only (and combined.svg's L cluster).
function save_span_split(dir, l, r; predicates=[])
    save_svg("$dir/L.svg",        didactic_state_view(codom(l); predicates=predicates))
    save_svg("$dir/K.svg",        didactic_state_view(dom(l)))
    save_svg("$dir/R.svg",        didactic_state_view(codom(r)))
    save_svg("$dir/combined.svg", didactic_span_view(l, r; predicates=predicates))
end

# Multi-state pathway: a horizontal chain of compact clusters connected by
# labeled green arrows representing rule firings. Pass `states` as an n-vector
# and `transitions` as an (n-1)-vector of edge labels (typically rule names).
function pathway_view(states, transitions;
                      titles=["step $(i-1)" for i in 1:length(states)])
    length(transitions) == length(states) - 1 ||
        error("expected length(transitions) == length(states) - 1")
    length(titles) == length(states) ||
        error("expected one title per state")

    stmts = Statement[]
    for (i, st) in enumerate(states)
        fill = i == length(states) ? "honeydew" : "aliceblue"
        push!(stmts, _didactic_cluster("S$i", titles[i], st, fill))
    end

    for i in 1:length(states)-1
        a_pre  = _first_anchor("S$i",     states[i])
        a_post = _first_anchor("S$(i+1)", states[i+1])
        push!(stmts, Edge(a_pre, a_post;
                          ltail="cluster_S$i", lhead="cluster_S$(i+1)",
                          label="  $(transitions[i])  ",
                          color="darkgreen", penwidth="2",
                          fontcolor="darkgreen", fontsize="11"))
    end

    Graph("pathway"; prog="dot",
          graph_attrs=Attributes(:rankdir=>"LR", :compound=>"true",
                                  :fontname=>"Helvetica",
                                  :nodesep=>"0.4", :ranksep=>"1.2",
                                  :label=>"clinical pathway as rule rewriting",
                                  :labelloc=>"t", :fontsize=>"14"),
          node_attrs=Attributes(:fontname=>"Helvetica"),
          edge_attrs=Attributes(:fontname=>"Helvetica", :fontsize=>"9"),
          stmts=stmts)
end
