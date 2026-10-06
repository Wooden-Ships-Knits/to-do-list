from typing import Any

import pytest
from fastapi.testclient import TestClient
from freezegun import freeze_time

from tests.conftest import Api

NOW = "2026-10-06 04:00:00"  # today = 2026-10-06 in Asia/Makassar


@pytest.fixture
def data(api: Api) -> dict[str, Any]:
    ann, bob = api.person("Ann"), api.person("Bob")
    api.project(
        "Overdue One", plan_date="2026-10-01", pic_ids=[ann["id"]], description="Sync inventory"
    )
    api.project("Due Today", plan_date="2026-10-06", stage="Testing", pic_ids=[bob["id"]])
    api.project("Due Plus 7", plan_date="2026-10-13", pic_ids=[ann["id"], bob["id"]])
    api.project("Plus 8 Track", plan_date="2026-10-14", status_notes="Waiting on WISER")
    api.project(
        "Adjusted Later",
        plan_date="2026-09-01",
        adjusted_plan_date="2026-10-30",
        category="pending",
    )
    api.project("No Dates", category="maintenance", ongoing_issue="UI is overwhelming")
    api.project("Finished", plan_date="2026-09-01", actual_date="2026-09-05", stage="Done")
    api.project("Under_Score 100%", plan_date="2026-11-01", category="pending")
    return {"ann": ann, "bob": bob}


def test_pagination(api: Api, data: dict[str, Any]) -> None:
    r = api.c.get("/api/v1/projects", params={"page_size": 3, "sort_by": "name"})
    body = r.json()
    assert body["total"] == 8 and len(body["items"]) == 3 and body["has_more"] is True
    r3 = api.c.get("/api/v1/projects", params={"page_size": 3, "page": 3, "sort_by": "name"}).json()
    assert len(r3["items"]) == 2 and r3["has_more"] is False
    assert api.c.get("/api/v1/projects", params={"page": 0}).status_code == 422
    assert api.c.get("/api/v1/projects", params={"page_size": 201}).status_code == 422


def test_filter_category(api: Api, data: dict[str, Any]) -> None:
    assert sorted(api.names(category="maintenance")) == ["No Dates"]
    assert sorted(api.names(category=["pending", "maintenance"])) == [
        "Adjusted Later",
        "No Dates",
        "Under_Score 100%",
    ]
    r = api.c.get("/api/v1/projects", params=[("category[]", "maintenance")])
    assert [p["name"] for p in r.json()["items"]] == ["No Dates"]
    assert api.c.get("/api/v1/projects", params={"category": "bogus"}).status_code == 422


def test_filter_stage(api: Api, data: dict[str, Any]) -> None:
    assert api.names(stage=api.stages["Testing"]) == ["Due Today"]
    both = api.names(stage=[api.stages["Testing"], api.stages["Done"]])
    assert sorted(both) == ["Due Today", "Finished"]


def test_filter_pic(api: Api, data: dict[str, Any]) -> None:
    ann, bob = data["ann"]["id"], data["bob"]["id"]
    assert sorted(api.names(pic=ann)) == ["Due Plus 7", "Overdue One"]
    assert sorted(api.names(pic=[ann, bob])) == ["Due Plus 7", "Due Today", "Overdue One"]
    assert len(api.names(pic="none")) == 5  # TBD / unassigned
    assert "Overdue One" in api.names(pic=[ann, "none"])
    assert "No Dates" in api.names(pic=[ann, "none"])
    assert api.c.get("/api/v1/projects", params={"pic": "xyz"}).status_code == 422


@freeze_time(NOW)
@pytest.mark.parametrize(
    ("status", "expected"),
    [
        ("overdue", ["Overdue One"]),
        ("due_soon", ["Due Plus 7", "Due Today"]),
        ("on_track", ["Adjusted Later", "Plus 8 Track", "Under_Score 100%"]),
        ("no_deadline", ["No Dates"]),
        ("done", ["Finished"]),
    ],
)
def test_filter_deadline_status(
    api: Api, data: dict[str, Any], status: str, expected: list[str]
) -> None:
    assert sorted(api.names(deadline_status=status)) == expected


@freeze_time(NOW)
def test_filter_deadline_status_multiple(api: Api, data: dict[str, Any]) -> None:
    assert sorted(api.names(deadline_status=["overdue", "done"])) == ["Finished", "Overdue One"]
    assert api.c.get("/api/v1/projects", params={"deadline_status": "x"}).status_code == 422


def test_search_is_case_insensitive_over_name_description_notes_issue(
    api: Api, data: dict[str, Any]
) -> None:
    assert api.names(search="OVERDUE") == ["Overdue One"]
    assert api.names(search="inventory") == ["Overdue One"]
    assert api.names(search="wiser") == ["Plus 8 Track"]
    assert api.names(search="overwhelming") == ["No Dates"]
    assert api.names(search="nothing-matches") == []


def test_search_escapes_like_wildcards(api: Api, data: dict[str, Any]) -> None:
    assert api.names(search="100%") == ["Under_Score 100%"]
    assert api.names(search="r_S") == ["Under_Score 100%"]
    assert api.names(search="%") == ["Under_Score 100%"]
    assert api.names(search="_") == ["Under_Score 100%"]


def test_column_text_filters(api: Api, data: dict[str, Any]) -> None:
    assert api.names(name="PLUS") == ["Due Plus 7", "Plus 8 Track"]
    assert api.names(description="SYNC") == ["Overdue One"]
    assert api.names(description="overwhelming") == ["No Dates"]
    assert api.names(status_notes="waiting") == ["Plus 8 Track"]


@pytest.mark.parametrize(
    "field", ["plan_date", "adjusted_plan_date", "actual_date", "projected_start_date"]
)
def test_date_range_and_tbd_filters_exist_for_every_date_field(api: Api, field: str) -> None:
    api.project("A", **{field: "2026-05-10"})
    api.project("B", **{field: "2026-06-10"})
    api.project("C")  # TBD
    assert api.names(**{f"{field}_from": "2026-06-01"}) == ["B"]
    assert api.names(**{f"{field}_to": "2026-05-31"}) == ["A"]
    assert sorted(api.names(**{f"{field}_from": "2026-05-01", f"{field}_to": "2026-06-30"})) == [
        "A",
        "B",
    ]
    assert api.names(**{f"{field}_tbd": "true"}) == ["C"]
    assert sorted(api.names(**{f"{field}_tbd": "false"})) == ["A", "B"]
    # range OR tbd
    assert sorted(api.names(**{f"{field}_to": "2026-05-31", f"{field}_tbd": "true"})) == ["A", "C"]
    # boundaries are inclusive
    assert api.names(**{f"{field}_from": "2026-05-10", f"{field}_to": "2026-05-10"}) == ["A"]


def test_effective_deadline_range_and_tbd_filter(api: Api) -> None:
    api.project("Plan only", plan_date="2026-05-10")
    api.project("Adjusted wins", plan_date="2026-01-01", adjusted_plan_date="2026-06-10")
    api.project("None")
    assert api.names(effective_deadline_from="2026-06-01") == ["Adjusted wins"]
    assert api.names(effective_deadline_to="2026-05-31") == ["Plan only"]
    assert api.names(effective_deadline_tbd="true") == ["None"]
    both = api.names(effective_deadline_to="2026-05-31", effective_deadline_tbd="true")
    assert sorted(both) == ["None", "Plan only"]


def test_filters_combine_with_and(api: Api, data: dict[str, Any]) -> None:
    ann = data["ann"]["id"]
    assert api.names(pic=ann, category="current", plan_date_from="2026-10-10") == ["Due Plus 7"]


def test_deleted_projects_never_listed(api: Api, data: dict[str, Any]) -> None:
    pid = api.c.get("/api/v1/projects", params={"search": "Finished"}).json()["items"][0]["id"]
    api.c.delete(f"/api/v1/projects/{pid}")
    assert "Finished" not in api.names(page_size=200)


@freeze_time(NOW)
def test_default_sort_is_category_then_deadline(api: Api, data: dict[str, Any]) -> None:
    cats = [p["category"] for p in api.c.get("/api/v1/projects").json()["items"]]
    assert cats == sorted(cats, key=["current", "pending", "maintenance"].index)


@pytest.mark.parametrize(
    "sort_by",
    [
        "category",
        "name",
        "description",
        "stage",
        "status_notes",
        "plan_date",
        "adjusted_plan_date",
        "effective_deadline",
        "actual_date",
        "projected_start_date",
        "pic",
        "deadline_status",
        "created_at",
        "updated_at",
    ],
)
@pytest.mark.parametrize("sort_dir", ["asc", "desc"])
def test_every_column_is_sortable(
    api: Api, data: dict[str, Any], sort_by: str, sort_dir: str
) -> None:
    r = api.c.get("/api/v1/projects", params={"sort_by": sort_by, "sort_dir": sort_dir})
    assert r.status_code == 200 and r.json()["total"] == 8


def test_sort_results(api: Api, data: dict[str, Any]) -> None:
    assert api.names(sort_by="name", sort_dir="asc")[0] == "Adjusted Later"
    assert api.names(sort_by="name", sort_dir="desc")[0] == "Under_Score 100%"
    # nulls always last
    by_plan = api.names(sort_by="plan_date", sort_dir="asc")
    assert by_plan[-1] == "No Dates"
    assert by_plan[0] in {"Adjusted Later", "Finished"}
    assert api.names(sort_by="plan_date", sort_dir="desc")[-1] == "No Dates"
    eff = api.names(sort_by="effective_deadline", sort_dir="asc")
    assert eff[:2] == ["Finished", "Overdue One"] and eff[-1] == "No Dates"
    stage = api.names(sort_by="stage", sort_dir="desc")
    assert stage[0] == "Finished"  # "Done" is the last stage
    pic = api.names(sort_by="pic", sort_dir="asc")
    assert pic[0] in {"Overdue One", "Due Plus 7"}  # Ann first
    assert api.c.get("/api/v1/projects", params={"sort_by": "bogus"}).status_code == 422
    assert api.c.get("/api/v1/projects", params={"sort_dir": "up"}).status_code == 422


@freeze_time(NOW)
def test_sort_by_deadline_status_rank(api: Api, data: dict[str, Any]) -> None:
    items = api.c.get(
        "/api/v1/projects", params={"sort_by": "deadline_status", "page_size": 200}
    ).json()["items"]
    order = [i["deadline_status"] for i in items]
    ranks = {"overdue": 1, "due_soon": 2, "on_track": 3, "no_deadline": 4, "done": 5}
    assert order == sorted(order, key=ranks.__getitem__)


def test_list_has_computed_fields(api: Api, data: dict[str, Any]) -> None:
    with freeze_time(NOW):
        item = api.c.get("/api/v1/projects", params={"search": "Adjusted"}).json()["items"][0]
    assert item["effective_deadline"] == "2026-10-30"
    assert item["deadline_status"] == "on_track"


def test_client_type(client: TestClient) -> None:
    assert client.get("/api/v1/projects").json()["total"] == 0
