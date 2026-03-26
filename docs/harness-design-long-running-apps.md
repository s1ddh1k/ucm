# Harness Design for Long-Running Application Development

**Published:** March 24, 2026
**Author:** Prithvi Rajasekaran, Anthropic Labs
**Source:** https://www.anthropic.com/engineering/harness-design-long-running-apps

## Overview

This article explores advanced techniques for getting Claude to produce high-quality frontend designs and build complete applications autonomously. The work applies a generator-evaluator pattern inspired by Generative Adversarial Networks (GANs) to tackle challenges in both subjective design tasks and objective coding work.

## Key Problems Addressed

### Context and Self-Evaluation Issues

The author identifies two persistent failure modes in long-running agentic tasks:

1. **Context degradation**: Models lose coherence as context windows fill. Some exhibit "context anxiety," prematurely wrapping up work as they approach context limits.

2. **Self-evaluation bias**: When asked to grade their own work, agents tend to offer inflated praise, particularly on subjective tasks where no verifiable test exists.

The solution involves separating the agent doing work from the agent evaluating it. As the author notes, "tuning a standalone evaluator to be skeptical turns out to be far more tractable than making a generator critical of its own work."

## Frontend Design Methodology

The researcher developed four grading criteria:

- **Design quality**: Coherent visual identity combining colors, typography, and layout
- **Originality**: Evidence of custom decisions versus template defaults
- **Craft**: Technical execution including typography hierarchy and spacing
- **Functionality**: Usability independent of aesthetics

By emphasizing design quality and originality, Claude moved away from "safe, predictable layouts" toward more distinctive work. The evaluator used Playwright to interact with live pages directly, providing detailed feedback that drove iterative improvement over 5-15 cycles per generation.

## Full-Stack Application Development

The three-agent architecture consists of:

**Planner**: Expands brief prompts into comprehensive product specifications, suggesting AI feature integration opportunities.

**Generator**: Builds applications incrementally using React, Vite, FastAPI, and SQLite/PostgreSQL stacks, working through defined sprints.

**Evaluator**: Tests running applications through Playwright, verifying functionality against negotiated "sprint contracts" that define success criteria before implementation begins.

## Performance Improvements

Comparing a solo agent run (20 minutes, $9) against the full harness (6 hours, $200) for a retro game maker:

The solo version produced a broken application where "nothing responded to input." The harness version delivered a polished interface with working gameplay mechanics, animated sprites, functional editors, and integrated AI features for sprite and level generation.

## Model Evolution and Simplification

When Claude Opus 4.6 released, the author tested removing unnecessary scaffold components. The improved model could sustain coherent work for multi-hour sessions without sprint decomposition, allowing single-pass evaluation at the end rather than per-sprint grading.

For a Digital Audio Workstation prompt, the refined harness ran approximately 3 hours 50 minutes at $124.70, producing a browser-based app with functional arrangement views, mixers, transport controls, and autonomous agent-driven composition capabilities.

## Key Insights

The author emphasizes that harness components encode assumptions about model limitations. "Every component in a harness encodes an assumption about what the model can't do on its own, and those assumptions are worth stress testing."

As models improve, effective harnesses don't disappear—they evolve. The frontier shifts outward, enabling new capabilities while eliminating now-redundant scaffolding. The real work for AI engineers involves "finding the next novel combination" rather than simply waiting for model improvements to solve problems independently.

The generator-evaluator pattern proved effective across fundamentally different domains, suggesting broader applicability for complex tasks requiring both creative judgment and verifiable outcomes.
