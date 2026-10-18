"""Rules written in more than one place stay equal to the Python rule: the protection ratio in the
screens, the skills and the preset, and the valuation models in the universe and the skills."""

import re

from egx_mcp.config import REPO_ROOT
from egx_mcp.pricing import PROTECTION_DISCOUNT
from egx_mcp.universe import VALUATION_MODEL_SKILLS, load_universe

RATIO = 1 - PROTECTION_DISCOUNT


def test_screens_use_the_python_protection_ratio():
    js = (REPO_ROOT / "bundle/src/format.mjs").read_text(encoding="utf-8")
    value = float(re.search(r"export const PROTECTION_RATIO = ([0-9.]+)", js).group(1))
    assert abs(value - RATIO) < 1e-9
    assert "'80%'" not in (REPO_ROOT / "bundle/src/analyses.js").read_text(encoding="utf-8")


def test_skills_and_preset_state_the_same_ratio():
    texts = {p: p.read_text(encoding="utf-8") for p in [
        REPO_ROOT / "skills/egx-valuation/SKILL.md", REPO_ROOT / "skills/egx-critic/SKILL.md",
        REPO_ROOT / "bundle/presets/egx-analyst.patch.yml", REPO_ROOT / "mcp/egx_mcp/server.py"]}
    for path, text in texts.items():
        stated = {float(x) for x in re.findall(r"(?:×|x|times)\s*(0\.\d+)", text)}
        assert stated == {RATIO}, f"{path.name} states {stated}, the rule is {RATIO}"


def test_every_valuation_model_has_its_skill():
    models = {c["valuation_model"] for c in load_universe()["constituents"]}
    assert models <= set(VALUATION_MODEL_SKILLS)
    guide = (REPO_ROOT / "skills/egx-valuation/SKILL.md").read_text(encoding="utf-8")
    for model, skill in VALUATION_MODEL_SKILLS.items():
        assert (REPO_ROOT / "skills" / skill / "SKILL.md").exists(), skill
        line = next((l for l in guide.splitlines() if f"`{model}`" in l and "→" in l), "")
        assert f"`{skill}`" in line, f"skills/egx-valuation/SKILL.md does not map {model} to {skill}"


def test_method_labels_name_real_methods():
    labels = (REPO_ROOT / "bundle/src/labels.mjs").read_text(encoding="utf-8")
    block = labels.split("export const METHOD_LABEL = {", 1)[1].split("}", 1)[0]
    keys = set(re.findall(r"^\s+([a-z_]+):", block, re.M))
    assert keys == {"dcf_fcff", "ddm", "multiples", "nav", "bank_justified_pb"}
