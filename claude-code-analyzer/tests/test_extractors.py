"""Tests for the Layer 3 extractor functions."""

from __future__ import annotations

import pytest

from claude_code_analyzer.models import Diagnostic, MarkdownSection, XmlSpan
from claude_code_analyzer.parsers.extractors import (
    extract_system_prompt,
    extract_tools,
    extract_user_message,
)


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _section(
    title: str,
    level: int = 1,
    body: str = "",
    raw: str = "",
    line_start: int = 1,
    line_end: int = 5,
    children: list[MarkdownSection] | None = None,
    xml_spans: list[XmlSpan] | None = None,
) -> MarkdownSection:
    if not raw:
        raw = f"{'#' * level} {title}\n{body}"
    return MarkdownSection(
        level=level,
        title=title,
        raw=raw,
        body=body,
        line_start=line_start,
        line_end=line_end,
        children=children or [],
        xml_spans=xml_spans or [],
    )


def _xml_span(
    tag: str,
    inner: str,
    line_start: int = 1,
    line_end: int = 4,
) -> XmlSpan:
    raw = f"<{tag}>\n{inner}\n</{tag}>"
    return XmlSpan(tag=tag, raw=raw, inner=inner, line_start=line_start, line_end=line_end)


# ===========================================================================
# 1. extract_user_message
# ===========================================================================

class TestExtractUserMessage:
    def test_system_reminder_child_ids(self):
        """Two system-reminder spans produce children at the correct IDs."""
        span0 = _xml_span("system-reminder", "No headings here.", line_start=2, line_end=4)
        span1 = _xml_span(
            "system-reminder",
            "## currentDate\nToday is 2026-04-29.\n## userEmail\nuser@example.com",
            line_start=6,
            line_end=12,
        )
        section = _section(
            title="User Message",
            body="<system-reminder>\nNo headings here.\n</system-reminder>\n"
                 "<system-reminder>\n## currentDate\nToday is 2026-04-29.\n"
                 "## userEmail\nuser@example.com\n</system-reminder>\n"
                 "The actual user question.",
            line_start=1,
            line_end=15,
            xml_spans=[span0, span1],
        )
        diagnostics: list[Diagnostic] = []
        comp = extract_user_message(section, diagnostics)

        assert comp.id == "user_message"
        assert comp.kind == "user_message"

        # Two system-reminder children
        assert "user_message/system_reminder/0" in comp.children
        assert "user_message/system_reminder/1" in comp.children

        # First reminder has no ## headings → no sub-children
        r0 = comp.children["user_message/system_reminder/0"]
        assert r0.kind == "system_reminder"
        assert r0.children == {}

        # Second reminder has ## currentDate and ## userEmail
        r1 = comp.children["user_message/system_reminder/1"]
        assert r1.kind == "system_reminder"
        assert "user_message/system_reminder/1/currentDate" in r1.children
        assert "user_message/system_reminder/1/userEmail" in r1.children

        # Context-block kind
        cb = r1.children["user_message/system_reminder/1/currentDate"]
        assert cb.kind == "context_block"
        assert cb.title == "currentDate"

    def test_actual_prompt_child_present(self):
        """actual_prompt child is always created."""
        section = _section(
            title="User Message",
            body="Hello, Claude!",
            line_start=1,
            line_end=3,
        )
        diagnostics: list[Diagnostic] = []
        comp = extract_user_message(section, diagnostics)

        assert "user_message/actual_prompt" in comp.children
        ap = comp.children["user_message/actual_prompt"]
        assert ap.kind == "actual_prompt"
        assert "Hello, Claude!" in ap.raw

    def test_empty_actual_prompt_emits_diagnostic(self):
        """When body has only XML spans, empty_actual_prompt diagnostic is emitted."""
        span = _xml_span("system-reminder", "some context", line_start=2, line_end=5)
        # body lines 2-5 all inside the span; nothing outside
        body_text = "<system-reminder>\nsome context\n</system-reminder>"
        section = _section(
            title="User Message",
            body=body_text,
            line_start=1,
            line_end=6,
            xml_spans=[span],
        )
        diagnostics: list[Diagnostic] = []
        extract_user_message(section, diagnostics)

        codes = [d.code for d in diagnostics]
        assert "empty_actual_prompt" in codes

    def test_no_system_reminders(self):
        """Section with no XML spans has no system_reminders children."""
        section = _section(
            title="User Message",
            body="Just a plain message.",
            line_start=1,
            line_end=3,
        )
        diagnostics: list[Diagnostic] = []
        comp = extract_user_message(section, diagnostics)

        reminder_children = [k for k in comp.children if "system_reminder" in k]
        assert reminder_children == []
        assert "user_message/actual_prompt" in comp.children

    def test_normalized_and_hash_set(self):
        """normalized and hash fields are populated on the top-level component."""
        section = _section(
            title="User Message",
            body="Hello!",
            line_start=1,
            line_end=3,
        )
        comp = extract_user_message(section, [])
        assert comp.normalized != ""
        assert len(comp.hash) == 16

    def test_path_is_correct(self):
        """Top-level component path is ['User Message']."""
        section = _section(title="User Message", body="hi", line_start=1, line_end=2)
        comp = extract_user_message(section, [])
        assert comp.path == ["User Message"]


# ===========================================================================
# 2. extract_system_prompt
# ===========================================================================

class TestExtractSystemPrompt:
    def _make_section(self) -> MarkdownSection:
        """
        Build a system-prompt section with structure:
          ## System
          ## Doing tasks
            ### Sub-task
          ## Environment
        """
        sub_task = _section(
            title="Sub-task",
            level=3,
            body="Sub-task body.",
            line_start=12,
            line_end=15,
        )
        doing_tasks = _section(
            title="Doing tasks",
            level=2,
            body="Intro to doing tasks.",
            line_start=8,
            line_end=20,
            children=[sub_task],
        )
        system_child = _section(
            title="System",
            level=2,
            body="System body.",
            line_start=3,
            line_end=7,
        )
        environment = _section(
            title="Environment",
            level=2,
            body="Env details.",
            line_start=21,
            line_end=25,
        )
        return _section(
            title="System Prompt",
            level=1,
            body="",
            line_start=1,
            line_end=30,
            children=[system_child, doing_tasks, environment],
        )

    def test_direct_children_ids(self):
        """Three ## children produce three child components."""
        section = self._make_section()
        diagnostics: list[Diagnostic] = []
        comp = extract_system_prompt(section, diagnostics)

        assert comp.id == "system_prompt"
        assert comp.kind == "system_prompt"
        assert "system_prompt/System" in comp.children
        assert "system_prompt/Doing tasks" in comp.children
        assert "system_prompt/Environment" in comp.children

    def test_grandchild_recursed(self):
        """### grandchild is recursed into and available under the ## child."""
        section = self._make_section()
        diagnostics: list[Diagnostic] = []
        comp = extract_system_prompt(section, diagnostics)

        doing_tasks = comp.children["system_prompt/Doing tasks"]
        assert "system_prompt/Doing tasks/Sub-task" in doing_tasks.children
        sub_task = doing_tasks.children["system_prompt/Doing tasks/Sub-task"]
        assert sub_task.kind == "system_prompt_section"

    def test_section_kinds(self):
        """All child/grandchild components have kind='system_prompt_section'."""
        section = self._make_section()
        comp = extract_system_prompt(section, [])

        for child in comp.children.values():
            assert child.kind == "system_prompt_section"
            for grandchild in child.children.values():
                assert grandchild.kind == "system_prompt_section"

    def test_path_includes_parent_and_child_titles(self):
        """Grandchild path contains System Prompt → parent title → child title."""
        section = self._make_section()
        comp = extract_system_prompt(section, [])

        sub_task = comp.children["system_prompt/Doing tasks"].children[
            "system_prompt/Doing tasks/Sub-task"
        ]
        assert sub_task.path == ["System Prompt", "Doing tasks", "Sub-task"]

    def test_unexpected_heading_depth_diagnostic(self):
        """A great-grandchild triggers unexpected_heading_depth warning."""
        great_grandchild = _section(
            title="Deep", level=4, body="very deep", line_start=20, line_end=22
        )
        grandchild = _section(
            title="GrandChild",
            level=3,
            body="gc body",
            line_start=15,
            line_end=23,
            children=[great_grandchild],
        )
        child = _section(
            title="Parent",
            level=2,
            body="parent body",
            line_start=5,
            line_end=24,
            children=[grandchild],
        )
        section = _section(
            title="System Prompt",
            level=1,
            body="",
            line_start=1,
            line_end=30,
            children=[child],
        )
        diagnostics: list[Diagnostic] = []
        extract_system_prompt(section, diagnostics)

        codes = [d.code for d in diagnostics]
        assert "unexpected_heading_depth" in codes

    def test_no_children_produces_only_preamble(self):
        """A system prompt with no ## sections still surfaces its body as a Preamble child."""
        section = _section(
            title="System Prompt",
            level=1,
            body="Just raw text.",
            line_start=1,
            line_end=5,
        )
        comp = extract_system_prompt(section, [])
        assert list(comp.children.keys()) == ["system_prompt/Preamble"]
        preamble = comp.children["system_prompt/Preamble"]
        assert preamble.title == "Preamble"
        assert preamble.normalized == "Just raw text."

    def test_empty_body_produces_no_preamble(self):
        """A system prompt whose body is whitespace-only does NOT emit a preamble."""
        section = _section(
            title="System Prompt",
            level=1,
            body="   \n  \n",
            line_start=1,
            line_end=5,
        )
        comp = extract_system_prompt(section, [])
        assert comp.children == {}


# ===========================================================================
# 3. extract_tools
# ===========================================================================

class TestExtractTools:
    def _tool_body_with_json(self) -> str:
        return (
            "This tool does something useful.\n"
            "It accepts a path argument.\n"
            "{\n"
            '  "name": "Bash",\n'
            '  "description": "Run a shell command",\n'
            '  "parameters": {"type": "object"}\n'
            "}"
        )

    def _make_tools_section(
        self,
        extra_tools: list[MarkdownSection] | None = None,
    ) -> MarkdownSection:
        bash_tool = _section(
            title="Bash",
            level=2,
            body=self._tool_body_with_json(),
            line_start=3,
            line_end=15,
        )
        tools = [bash_tool] + (extra_tools or [])
        return _section(
            title="Tools",
            level=1,
            body="",
            line_start=1,
            line_end=50,
            children=tools,
        )

    def test_schema_and_prose_split(self):
        """Tool body ending with JSON produces schema and prose children."""
        section = self._make_tools_section()
        diagnostics: list[Diagnostic] = []
        comp = extract_tools(section, diagnostics)

        bash = comp.children["tools/Bash"]
        assert bash.kind == "tool"
        assert "tools/Bash/schema" in bash.children
        assert "tools/Bash/prose" in bash.children

        schema = bash.children["tools/Bash/schema"]
        assert schema.kind == "tool_schema"
        assert '"name"' in schema.raw

        prose = bash.children["tools/Bash/prose"]
        assert prose.kind == "tool_prose"
        assert "This tool does something useful." in prose.raw

    def test_no_json_block_emits_diagnostic(self):
        """Tool whose body has no JSON block emits tool_without_schema."""
        no_schema_tool = _section(
            title="TextOnly",
            level=2,
            body="Just descriptive text, no JSON.",
            line_start=5,
            line_end=8,
        )
        section = _section(
            title="Tools",
            level=1,
            body="",
            line_start=1,
            line_end=20,
            children=[no_schema_tool],
        )
        diagnostics: list[Diagnostic] = []
        comp = extract_tools(section, diagnostics)

        codes = [d.code for d in diagnostics]
        assert "tool_without_schema" in codes

        # prose child still created; schema child absent
        text_only = comp.children["tools/TextOnly"]
        assert "tools/TextOnly/prose" in text_only.children
        assert "tools/TextOnly/schema" not in text_only.children

    def test_invalid_json_schema_emits_diagnostic(self):
        """Malformed JSON block emits tool_schema_parse_failed."""
        bad_json_tool = _section(
            title="BadTool",
            level=2,
            body="Some prose.\n{\n  invalid json here\n}",
            line_start=3,
            line_end=8,
        )
        section = _section(
            title="Tools",
            level=1,
            body="",
            line_start=1,
            line_end=15,
            children=[bad_json_tool],
        )
        diagnostics: list[Diagnostic] = []
        extract_tools(section, diagnostics)

        codes = [d.code for d in diagnostics]
        assert "tool_schema_parse_failed" in codes

    def test_duplicate_tool_name_emits_diagnostic(self):
        """Two tools with the same title emit duplicate_tool_name."""
        tool_a = _section(title="Bash", level=2, body="first", line_start=3, line_end=5)
        tool_b = _section(title="Bash", level=2, body="second", line_start=6, line_end=8)
        section = _section(
            title="Tools",
            level=1,
            body="",
            line_start=1,
            line_end=20,
            children=[tool_a, tool_b],
        )
        diagnostics: list[Diagnostic] = []
        extract_tools(section, diagnostics)

        codes = [d.code for d in diagnostics]
        assert "duplicate_tool_name" in codes

    def test_subsection_children(self):
        """### subsections inside a tool become tool_subsection children."""
        subsection = _section(
            title="Examples",
            level=3,
            body="Example content.",
            line_start=10,
            line_end=14,
        )
        tool_body = (
            "Describes the tool.\n"
            '{"name": "Read", "description": "Read a file", "parameters": {}}'
        )
        read_tool = _section(
            title="Read",
            level=2,
            body=tool_body,
            line_start=3,
            line_end=20,
            children=[subsection],
        )
        section = _section(
            title="Tools",
            level=1,
            body="",
            line_start=1,
            line_end=25,
            children=[read_tool],
        )
        diagnostics: list[Diagnostic] = []
        comp = extract_tools(section, diagnostics)

        read = comp.children["tools/Read"]
        assert "tools/Read/subsections/Examples" in read.children
        examples = read.children["tools/Read/subsections/Examples"]
        assert examples.kind == "tool_subsection"
        assert examples.title == "Examples"

    def test_top_level_component_structure(self):
        """Top-level component has correct id, kind, title, and path."""
        section = self._make_tools_section()
        comp = extract_tools(section, [])

        assert comp.id == "tools"
        assert comp.kind == "tools"
        assert comp.title == "Tools"
        assert comp.path == ["Tools"]

    def test_tool_path(self):
        """Tool child has path ['Tools', <tool_title>]."""
        section = self._make_tools_section()
        comp = extract_tools(section, [])

        bash = comp.children["tools/Bash"]
        assert bash.path == ["Tools", "Bash"]

    def test_normalized_and_hash_set(self):
        """normalized and hash are populated on tools components."""
        section = self._make_tools_section()
        comp = extract_tools(section, [])

        assert comp.normalized != ""
        assert len(comp.hash) == 16
        for child in comp.children.values():
            assert child.normalized != ""
            assert len(child.hash) == 16

    def test_multiple_tools_all_present(self):
        """Multiple tools each get their own child entry."""
        write_tool = _section(
            title="Write",
            level=2,
            body='Write a file.\n{"name": "Write", "parameters": {}}',
            line_start=16,
            line_end=22,
        )
        section = self._make_tools_section(extra_tools=[write_tool])
        diagnostics: list[Diagnostic] = []
        comp = extract_tools(section, diagnostics)

        assert "tools/Bash" in comp.children
        assert "tools/Write" in comp.children
        assert diagnostics == []
