"""Tests for the Layer-1 Markdown parser (parsers/markdown.py)."""

from __future__ import annotations

import pytest

from claude_code_analyzer.parsers.markdown import parse_markdown
from claude_code_analyzer.models import MarkdownDoc, MarkdownSection, XmlSpan


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _section_titles(sections: list[MarkdownSection]) -> list[str]:
    return [s.title for s in sections]


# ---------------------------------------------------------------------------
# Test 1 – Simple two-section document with nested headings
# ---------------------------------------------------------------------------

SIMPLE_DOC = """\
# Section One

Some introductory text.

## Sub One A

Content A.

## Sub One B

Content B.

# Section Two

More content here.
"""


def test_simple_two_sections_top_level():
    doc = parse_markdown(SIMPLE_DOC)
    assert isinstance(doc, MarkdownDoc)
    assert _section_titles(doc.sections) == ["Section One", "Section Two"]


def test_simple_two_sections_children():
    doc = parse_markdown(SIMPLE_DOC)
    sec1 = doc.sections[0]
    assert _section_titles(sec1.children) == ["Sub One A", "Sub One B"]
    # Section Two has no children
    assert doc.sections[1].children == []


def test_simple_section_levels():
    doc = parse_markdown(SIMPLE_DOC)
    assert doc.sections[0].level == 1
    assert doc.sections[1].level == 1
    assert doc.sections[0].children[0].level == 2
    assert doc.sections[0].children[1].level == 2


def test_simple_section_line_numbers():
    doc = parse_markdown(SIMPLE_DOC)
    sec1 = doc.sections[0]
    # "# Section One" is line 1
    assert sec1.line_start == 1
    # Section One ends on the line before "# Section Two"
    sec2 = doc.sections[1]
    assert sec1.line_end == sec2.line_start - 1

    sub_a = sec1.children[0]
    sub_b = sec1.children[1]
    assert sub_a.line_start < sub_b.line_start
    assert sub_a.line_end == sub_b.line_start - 1


def test_simple_body_does_not_include_child_heading():
    doc = parse_markdown(SIMPLE_DOC)
    sec1 = doc.sections[0]
    assert "## Sub One A" not in sec1.body
    assert "Some introductory text." in sec1.body


def test_simple_no_xml_spans():
    doc = parse_markdown(SIMPLE_DOC)
    for sec in doc.sections:
        assert sec.xml_spans == []


def test_simple_preamble_empty():
    doc = parse_markdown(SIMPLE_DOC)
    assert doc.preamble.strip() == ""


# ---------------------------------------------------------------------------
# Test 2 – Heading inside an XML tag must NOT appear in the section tree
#           but MUST appear as an xml_span on the enclosing section
# ---------------------------------------------------------------------------

XML_DOC = """\
# Outer Section

Normal body text.

<system-reminder>
## Inner Heading

This heading is inside an XML tag.
</system-reminder>

More body text.

# Another Section

Content.
"""


def test_xml_inner_heading_not_in_tree():
    doc = parse_markdown(XML_DOC)
    # Only top-level headings should be present; the inner ## is swallowed.
    assert _section_titles(doc.sections) == ["Outer Section", "Another Section"]
    # The outer section should have no children
    assert doc.sections[0].children == []


def test_xml_inner_heading_not_in_another_section_children():
    doc = parse_markdown(XML_DOC)
    assert doc.sections[1].children == []


def test_xml_span_attached_to_parent_section():
    doc = parse_markdown(XML_DOC)
    outer = doc.sections[0]
    assert len(outer.xml_spans) == 1
    span = outer.xml_spans[0]
    assert isinstance(span, XmlSpan)
    assert span.tag == "system-reminder"


def test_xml_span_inner_content():
    doc = parse_markdown(XML_DOC)
    span = doc.sections[0].xml_spans[0]
    assert "## Inner Heading" in span.inner
    assert "This heading is inside an XML tag." in span.inner


def test_xml_span_raw_includes_tags():
    doc = parse_markdown(XML_DOC)
    span = doc.sections[0].xml_spans[0]
    assert span.raw.startswith("<system-reminder>")
    assert span.raw.endswith("</system-reminder>")


def test_xml_span_not_on_another_section():
    doc = parse_markdown(XML_DOC)
    another = doc.sections[1]
    assert another.xml_spans == []


# ---------------------------------------------------------------------------
# Test 3 – Heading inside a fenced code block is NOT parsed as a heading
# ---------------------------------------------------------------------------

FENCED_DOC = """\
# Real Heading

Some text.

```
# This is inside a fence
## Also inside
```

More text.

# Another Real Heading

Done.
"""


def test_fenced_headings_ignored():
    doc = parse_markdown(FENCED_DOC)
    titles = _section_titles(doc.sections)
    assert "Real Heading" in titles
    assert "Another Real Heading" in titles
    assert "This is inside a fence" not in titles
    assert "Also inside" not in titles


def test_fenced_only_two_top_level_sections():
    doc = parse_markdown(FENCED_DOC)
    assert len(doc.sections) == 2


def test_fenced_no_children():
    doc = parse_markdown(FENCED_DOC)
    assert doc.sections[0].children == []
    assert doc.sections[1].children == []


def test_fenced_tilde_fence():
    text = """\
# Title

~~~
## Not a heading
~~~

# End
"""
    doc = parse_markdown(text)
    titles = _section_titles(doc.sections)
    assert "Not a heading" not in titles
    assert "Title" in titles
    assert "End" in titles


# ---------------------------------------------------------------------------
# Test 4 – Preamble extraction
# ---------------------------------------------------------------------------

PREAMBLE_DOC = """\
This is the preamble.
It spans multiple lines.

And has blank lines too.

# First Heading

Content.
"""


def test_preamble_extracted():
    doc = parse_markdown(PREAMBLE_DOC)
    assert "This is the preamble." in doc.preamble
    assert "It spans multiple lines." in doc.preamble
    assert "And has blank lines too." in doc.preamble


def test_preamble_does_not_include_heading():
    doc = parse_markdown(PREAMBLE_DOC)
    assert "# First Heading" not in doc.preamble


def test_preamble_sections_still_parsed():
    doc = parse_markdown(PREAMBLE_DOC)
    assert len(doc.sections) == 1
    assert doc.sections[0].title == "First Heading"


def test_no_headings_entire_doc_is_preamble():
    text = "Just a plain document.\nNo headings at all.\n"
    doc = parse_markdown(text)
    assert doc.sections == []
    assert "Just a plain document." in doc.preamble
    assert "No headings at all." in doc.preamble


def test_empty_preamble_when_heading_is_first_line():
    text = "# Title\n\nContent.\n"
    doc = parse_markdown(text)
    assert doc.preamble == ""


# ---------------------------------------------------------------------------
# Test 5 – Edge cases
# ---------------------------------------------------------------------------

def test_unclosed_xml_tag_treated_as_plain_text():
    text = """\
# Section

<unclosed>
## Heading inside unclosed tag

</section>
"""
    doc = parse_markdown(text)
    # The unclosed tag doesn't create an XmlSpan, so the ## heading IS parsed.
    titles = _section_titles(doc.sections[0].children)
    assert "Heading inside unclosed tag" in titles
    assert doc.sections[0].xml_spans == []


def test_nested_same_name_xml_outermost_pair():
    # Outermost open matches outermost close.
    text = """\
# Section

<wrap>
<wrap>
Inner content
</wrap>
Still in outer wrap
</wrap>

More text.
"""
    doc = parse_markdown(text)
    sec = doc.sections[0]
    assert len(sec.xml_spans) == 1
    span = sec.xml_spans[0]
    assert "Still in outer wrap" in span.inner


def test_multiple_xml_spans_in_one_section():
    text = """\
# Section

<alpha>First span</alpha>

Some text.

<beta>Second span</beta>
"""
    doc = parse_markdown(text)
    sec = doc.sections[0]
    tags = {s.tag for s in sec.xml_spans}
    assert "alpha" in tags
    assert "beta" in tags


def test_raw_field_populated():
    doc = parse_markdown(SIMPLE_DOC)
    assert doc.raw == SIMPLE_DOC


def test_section_raw_contains_full_content():
    doc = parse_markdown(SIMPLE_DOC)
    sec1 = doc.sections[0]
    # raw should start with the heading line
    assert sec1.raw.startswith("# Section One")
    # raw should include child heading text
    assert "## Sub One A" in sec1.raw
