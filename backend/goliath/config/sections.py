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


SECTION_BOUNDARIES_M: tuple[float, ...] = (
    0.0,
    17630.242,
    31659.142,
    42581.232,
    60737.384,
    74188.316,
)

SECTION_DEFINITIONS: tuple[tuple[str, str, str, str], ...] = (
    (
        "S1",
        "スタートから登り前",
        "Start to before the main climb",
        "Opening section before the main uphill portion.",
    ),
    (
        "S2",
        "登り区間",
        "Main uphill section",
        "Main climb with repeated medium- and high-speed corners.",
    ),
    (
        "S3",
        "下り区間",
        "Main downhill section",
        "Main descent where stability and braking confidence matter.",
    ),
    (
        "S4",
        "下り後の高速フラット区間",
        "Flat/high-speed corner section after the descent",
        "Fast flatter portion after the descent.",
    ),
    (
        "S5",
        "ループ橋進入と起伏区間",
        "Loop-bridge approach and rolling elevation section",
        "Rolling elevation section around the loop-bridge approach.",
    ),
    (
        "S6",
        "フィニッシュまでの最終フラット区間",
        "Final flat section to the finish",
        "Final flatter run to the finish.",
    ),
)


def validate_sections(sections: tuple[Section, ...]) -> None:
    if len(sections) != 6:
        raise ValueError(f"expected 6 sections, got {len(sections)}")

    for section in sections:
        if section.start_distance_m >= section.end_distance_m:
            raise ValueError(f"section {section.id} has invalid bounds")

    for previous, current in zip(sections, sections[1:]):
        if previous.end_distance_m != current.start_distance_m:
            raise ValueError(f"section gap or overlap between {previous.id} and {current.id}")


def build_sections(finish_distance_m: float) -> tuple[Section, ...]:
    if finish_distance_m <= SECTION_BOUNDARIES_M[-1]:
        raise ValueError(
            "finish distance must be after the S6 start boundary: "
            f"{finish_distance_m} <= {SECTION_BOUNDARIES_M[-1]}"
        )

    boundaries = (*SECTION_BOUNDARIES_M, finish_distance_m)
    sections = tuple(
        Section(
            id=section_id,
            name_ja=name_ja,
            name_en=name_en,
            start_distance_m=boundaries[index],
            end_distance_m=boundaries[index + 1],
            description=description,
        )
        for index, (section_id, name_ja, name_en, description) in enumerate(SECTION_DEFINITIONS)
    )
    validate_sections(sections)
    return sections


SECTIONS: tuple[Section, ...] = build_sections(84677.15121230017)


def assign_section_id(course_distance_m: float, sections: tuple[Section, ...] = SECTIONS) -> str:
    """Return the confirmed Goliath section ID for a course distance."""
    if course_distance_m < sections[0].start_distance_m:
        raise ValueError(f"course distance is before the start: {course_distance_m}")

    for section in sections:
        if section.start_distance_m <= course_distance_m < section.end_distance_m:
            return section.id

    final = sections[-1]
    if course_distance_m <= final.end_distance_m:
        return final.id
    raise ValueError(f"course distance is beyond the configured finish: {course_distance_m}")


def section_index(section_id: str, sections: tuple[Section, ...]) -> int:
    for index, section in enumerate(sections):
        if section.id == section_id:
            return index
    raise ValueError(f"unknown section ID: {section_id}")


def boundary_markers(sections: tuple[Section, ...] = SECTIONS) -> list[dict[str, float | str]]:
    markers: list[dict[str, float | str]] = []
    for index, section in enumerate(sections[1:], start=1):
        markers.append(
            {
                "id": f"P{index}",
                "label": f"P{index}",
                "course_distance_m": section.start_distance_m,
                "from_section_id": sections[index - 1].id,
                "to_section_id": section.id,
            }
        )
    return markers


def sections_as_dicts(sections: tuple[Section, ...] = SECTIONS) -> list[dict[str, float | str]]:
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
        for section in sections
    ]
