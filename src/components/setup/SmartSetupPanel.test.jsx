import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import SmartSetupPanel from "./SmartSetupPanel";

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SmartSetupPanel
        user={{ email: "owner@example.com" }}
        myCompany={{ id: "company-1", website: "" }}
      />
    </QueryClientProvider>,
  );
}

describe("SmartSetupPanel", () => {
  it("keeps the website input mounted and focused while typing", async () => {
    const user = userEvent.setup();
    renderPanel();

    const websiteInput = screen.getByTestId("input-smart-website");
    await user.click(websiteInput);
    await user.type(websiteInput, "example.com");

    expect(screen.getByTestId("input-smart-website")).toBe(websiteInput);
    expect(websiteInput).toHaveFocus();
    expect(websiteInput).toHaveValue("example.com");
  });
});