# UI Research Reference

Date: 2026-03-14

## Purpose

This document captures the UI research direction for understanding long system-prompt evolution as a semantic and structural artifact, rather than as an LLM observability dashboard.

The target question is:

- how do major instruction ideas appear, mutate, disappear, move, and reappear over time
- how should that be shown in a way that supports both fast orientation and evidence-backed inspection

## Research frame

The most relevant prior work is not prompt management software. It is the scientific and visual-analytics literature around:

- document revision history
- topic or theme evolution
- semantic shift in vector space
- storyline and lineage views for concepts over time

That framing matters because this project is trying to support:

- current-state understanding
- cross-sectional discovery
- idea lineage
- evidence inspection

## Relevant precedents

### 1. History Flow

Source:

- https://courses.ischool.berkeley.edu/i247/f05/readings/Viegas_HistoryFlow_CHI04.pdf

Why it matters:

- treats a document as a historical object, not just a latest snapshot
- uses overview plus drilldown
- emphasizes continuity, deletion, and persistence across revisions

What to borrow:

- a section-level continuity view
- a direct link from overview to evidence
- a visual distinction between persistent structure and rewritten structure

### 2. ThemeRiver

Source:

- https://www.pnnl.gov/publications/themeriver-visualizing-thematic-changes-document-collections

Why it matters:

- shows theme strength over time at a macro level
- works well for "what topics are gaining or losing prominence"

What to borrow:

- macro overview of major prompt ideas
- a way to show relative prominence without forcing raw diff inspection first

### 3. TopicFlow

Source:

- https://alisonmsmith.github.io/assets/refs/springer-topicflow.pdf

Why it matters:

- directly addresses topic evolution
- uses flow-style links to show continuation, emergence, and ending
- supports split and merge patterns

What to borrow:

- lineage view for major ideas
- alluvial or Sankey-like representation of conceptual transitions
- a distinction between section identity and idea identity

### 4. TextEssence

Source:

- https://pmc.ncbi.nlm.nih.gov/articles/PMC8212692/

Why it matters:

- focuses on semantic shift rather than only string-level change
- combines overview with local neighborhood inspection

What to borrow:

- semantic summaries for section changes
- concept comparison beyond literal text matching
- a bridge between embedding-space reasoning and readable evidence

### 5. SCoT

Source:

- https://arxiv.org/abs/2203.09892

Why it matters:

- models meaning as evolving neighborhoods over time
- reinforces that semantic change should be treated relationally, not just as point diffs

What to borrow:

- neighborhood-style semantic context around a section or idea
- confidence that "same idea, new wording" is a first-class concept in the UI

### 6. LitStoryTeller

Source:

- https://arxiv.org/abs/1708.02214

Why it matters:

- shows entities and concept communities as evolving storylines
- supports temporal reading of concepts as if they are actors in a narrative

What to borrow:

- storyline thinking for major idea branches
- a detail page that reads like a historical narrative, not a diff dump

### 7. Visualization Methods for Diachronic Semantic Shift

Source:

- https://aclanthology.org/2022.sdp-1.10.pdf

Why it matters:

- gives a survey-like view of semantic shift visualization methods
- shows that there is no single dominant visual grammar

What to borrow:

- confidence to mix view types across pages
- use one visual for overview and another for evidence

## What this means for this project

The strongest design conclusion is that the product should not be organized around raw version diffs alone.

The UI needs at least four different analytical behaviors:

- orientation: what is here now
- structural understanding: how the prompt is currently organized
- lineage: what major ideas changed over time
- verification: what text evidence supports that interpretation

That led to the current 7-page prototype.

## Current page model

### 1. Overview

Purpose:

- orient the user quickly
- show the current window, strongest transitions, and navigation into the rest of the site

Research influence:

- ThemeRiver for macro framing
- History Flow for overview before detail

### 2. Sections

Purpose:

- present the current prompt as a set of major sections
- let the user browse the prompt as written now

Research influence:

- document structure browsing
- current-state framing before temporal reasoning

### 3. Section Detail

Purpose:

- explain one section at the current state
- show the current units and the change trail for that section

Research influence:

- History Flow
- TextEssence-style local inspection

### 4. Lineages

Purpose:

- surface conceptual threads rather than raw section paths
- provide an index of major idea changes

Research influence:

- TopicFlow
- LitStoryTeller

### 5. Lineage Detail

Purpose:

- tell the story of one major idea
- show active sections, transitions, and evidence

Research influence:

- TopicFlow split and continuation logic
- storyline presentation from LitStoryTeller

### 6. Compare

Purpose:

- support direct version-to-version evidence reading
- keep exact structural evidence available without letting it dominate the whole product

Research influence:

- standard diff tooling
- auditability requirement from scientific interfaces

### 7. Method

Purpose:

- make the analysis inspectable and criticizable
- state the parsing rules, live facts, and limitations

Research influence:

- scientific reporting norms
- trust-building through explicit method disclosure

## Design principles confirmed by the research

### Use multiple view types

One view cannot do everything. The literature supports mixing:

- overview views
- flow or lineage views
- detail inspection views
- method or provenance views

### Keep overview and evidence linked

The user should be able to move from:

- macro pattern
- to one section or lineage
- to concrete supporting text

without losing context.

### Separate section identity from idea identity

A section path is not the same thing as a conceptual thread.

This is one of the core ideas from the research direction:

- sections are document structure
- lineages are semantic interpretation

The UI should preserve both.

### Make semantic interpretation auditable

If the system says:

- this idea was reintroduced
- this idea moved
- this section is a refinement of an older policy

the user should be able to inspect the evidence that supports that claim.

## Current limitations of the prototype

The 7-page prototype is still an interface prototype, not a finished research system.

Current limitations:

- section identity is still path-based
- lineages are example groupings, not fully inferred semantic graphs
- semantic shift is summarized lightly rather than modeled deeply
- the compare page uses the latest-five analysis window only

## Recommended next research steps

### 1. Move from section diffs to idea lineage

Build an idea graph that supports:

- same idea
- refinement
- split
- merge
- disappearance
- reintroduction

### 2. Use a hybrid pipeline

Do not send the whole history to the model at once.

Prefer:

- deterministic section parsing
- cheap pre-filtering for candidate changes
- LLM semantic analysis only on flagged sections
- explicit evidence fields in outputs

### 3. Add one stronger lineage visualization

The current prototype is page-structured, but it does not yet contain a true visual lineage diagram.

The most promising addition is:

- an alluvial or Sankey-like lineage strip on the lineage detail page

### 4. Add semantic summaries per section

Each current section page should eventually answer:

- what is this section for
- what are its main rules
- what changed most meaningfully over time

## Bottom line

The main UI insight from the research is:

this project should combine the logic of document history tools, topic evolution systems, and semantic shift analysis.

It should not look like a generic prompt ops dashboard, and it should not collapse into a single diff viewer.
