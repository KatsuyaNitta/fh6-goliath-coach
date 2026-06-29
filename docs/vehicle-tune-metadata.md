# Vehicle and Tune Metadata

Vehicle specifications are intentionally minimal.

Vehicle fields:

- vehicle name
- year
- class
- PI
- drivetrain
- power in PS
- torque in N·m
- weight in kg
- front weight distribution in percent
- free-text engine notes

Do not add separate structured fields for displacement, cylinder count, aspiration, engine family, or engine swap details. Put those details in `engine_notes`.

Tuning input order follows the Forza tuning screen:

1. tires
2. gearing
3. alignment
4. anti-roll bars
5. springs
6. ride height
7. damping
8. aero
9. brakes
10. differential

Units:

- tire pressure: bar
- power: PS
- torque: N·m
- weight: kg
- weight distribution: percent
- camber, toe, caster: degrees
- spring rate: kgf/mm
- ride height: cm
- aero downforce: kgf
- brake balance and pressure: percent
- differential settings: percent
- gear ratios, anti-roll bars, rebound, and bump: unitless game values

Differential metadata supports FWD, RWD, and AWD-specific forms. Vehicle and tune documents use `goliath-vehicle-tune-v1` and can be saved and loaded as JSON.
