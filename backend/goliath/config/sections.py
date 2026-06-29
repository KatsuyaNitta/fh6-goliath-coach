from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Section:
    id: str
    name_ja: str
    name_en: str
    start_distance_m: float
    end_distance_m: float
    description: str

    @property
    def length_m(self) -> float:
        return self.end_distance_m - self.start_distance_m


SECTIONS: tuple[Section, ...] = (
    Section(
        "S1",
        "スタートから登り前",
        "Start to before the main climb",
        0.0,
        17630.0,
        "Opening section before the main uphill portion.",
    ),
    Section(
        "S2",
        "登り区間",
        "Main uphill section",
        17630.0,
        31659.0,
        "Main climb with repeated medium- and high-speed corners.",
    ),
    Section(
        "S3",
        "下り区間",
        "Main downhill section",
        31659.0,
        42581.0,
        "Main descent where stability and braking confidence matter.",
    ),
    Section(
        "S4",
        "下り後の高速フラット区間",
        "Flat/high-speed corner section after the descent",
        42581.0,
        60737.0,
        "Fast flatter portion after the descent.",
    ),
    Section(
        "S5",
        "ループ橋進入と起伏区間",
        "Loop-bridge approach and rolling elevation section",
        60737.0,
        74188.0,
        "Rolling elevation section around the loop-bridge approach.",
    ),
    Section(
        "S6",
        "フィニッシュまでの最終フラット区間",
        "Final flat section to the finish",
        74188.0,
        84677.15121230017,
        "Final flatter run to the finish.",
    ),
)


def assign_section_id(course_distance_m: float) -> str:
    """Return the confirmed Goliath section ID for a course distance."""
    if course_distance_m < SECTIONS[0].start_distance_m:
        raise ValueError(f"course distance is before the start: {course_distance_m}")

    for section in SECTIONS:
        if section.start_distance_m <= course_distance_m < section.end_distance_m:
            return section.id

    final = SECTIONS[-1]
    if course_distance_m <= final.end_distance_m + 1.0:
        return final.id
    raise ValueError(f"course distance is beyond the configured finish: {course_distance_m}")


def boundary_markers() -> list[dict[str, float | str]]:
    markers: list[dict[str, float | str]] = []
    for index, section in enumerate(SECTIONS[1:], start=1):
        markers.append(
            {
                "id": f"P{index}",
                "label": f"P{index}",
                "course_distance_m": section.start_distance_m,
                "from_section_id": SECTIONS[index - 1].id,
                "to_section_id": section.id,
            }
        )
    return markers


def sections_as_dicts() -> list[dict[str, float | str]]:
    return [
        {
            "id": section.id,
            "name_ja": section.name_ja,
            "name_en": section.name_en,
            "start_distance_m": section.start_distance_m,
            "end_distance_m": section.end_distance_m,
            "length_m": section.length_m,
            "description": section.description,
        }
        for section in SECTIONS
    ]
