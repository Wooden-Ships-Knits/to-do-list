from app.wikilinks import WikiLink, find_links, rename_links


def test_finds_links_with_and_without_labels() -> None:
    body = "See [[Payroll ideas]] and [[HR App|the HR app]].\n- [[ Spaced  ]]"
    assert find_links(body) == [
        WikiLink("Payroll ideas", None),
        WikiLink("HR App", "the HR app"),
        WikiLink("Spaced", None),
    ]


def test_subtask_targets_keep_the_separator() -> None:
    assert find_links("[[HR App > Fix payroll]]") == [WikiLink("HR App > Fix payroll", None)]


def test_ignores_code_spans_and_fenced_code() -> None:
    body = (
        "real [[One]] `not [[Two]]` ``also not [[Three]]``\n"
        "```\n[[Four]] in a fence\n```\n"
        "~~~md\n[[Five]]\n~~~\n"
        "after [[Six]]"
    )
    assert [link.target for link in find_links(body)] == ["One", "Six"]


def test_ignores_empty_and_broken_links() -> None:
    assert find_links("[[]] [[ ]] [[a\nb]] [single] [[x]") == []


def test_rename_rewrites_matching_links_only_outside_code() -> None:
    body = (
        "[[Old title]] and [[old TITLE|my label]] and [[Old title extra]]\n"
        "`[[Old title]]`\n```\n[[Old title]]\n```\n"
    )
    assert rename_links(body, "Old title", "New title") == (
        "[[New title]] and [[New title|my label]] and [[Old title extra]]\n"
        "`[[Old title]]`\n```\n[[Old title]]\n```\n"
    )


def test_rename_leaves_text_without_links_untouched() -> None:
    body = "Nothing here\r\nstill nothing"
    assert rename_links(body, "a", "b") == body
