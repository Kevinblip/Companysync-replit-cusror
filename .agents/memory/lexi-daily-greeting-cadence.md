---
name: Lexi daily greeting cadence
description: Product behavior for Lexi's welcome cadence across repeated chats in the same day.
---

Lexi should welcome each staff member no more than once per local day, including when they move between the app's two Lexi chat screens. New chats later that day should open without a reintroduction and should answer the first request directly.

**Why:** The intended experience is like an ongoing conversation with a human coworker, not a first-time chatbot interaction every time the panel opens.

**How to apply:** Keep the welcome claim per signed-in user and use their local date, not UTC. Prompts should also prohibit repeated greetings so a model-generated opening cannot undermine the UI behavior.