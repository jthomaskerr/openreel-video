/**
 * @vitest-environment jsdom
 *
 * Regression tests for DropdownMenuContent.
 * Ensures the menu renders with correct data-state, animation
 * classes, and that the Radix Popper wrapper exists.
 *
 * The NaN available-width bug is fixed by pnpm patches:
 * - patches/@radix-ui__react-popper@1.2.8.patch
 * - patches/@floating-ui__core@1.7.3.patch
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@openreel/ui";

function renderOpenDropdown() {
  return render(
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <button data-testid="trigger">Star</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" data-testid="content">
        <DropdownMenuItem>Theme</DropdownMenuItem>
        <DropdownMenuItem>Settings</DropdownMenuItem>
        <DropdownMenuItem>Screen recorder</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("DropdownMenuContent", () => {
  it("renders the menu content when open", () => {
    renderOpenDropdown();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("renders menu items inside the content", () => {
    renderOpenDropdown();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Screen recorder")).toBeInTheDocument();
  });

  it("has data-state='open' on the menu content", () => {
    renderOpenDropdown();
    const menu = screen.getByRole("menu");
    expect(menu).toHaveAttribute("data-state", "open");
  });

  it("has data-side attribute on the content", () => {
    renderOpenDropdown();
    const menu = screen.getByRole("menu");
    expect(menu).toHaveAttribute("data-side");
  });

  it("has animation classes present (enter + exit)", () => {
    renderOpenDropdown();
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("data-[state=open]:animate-in");
    expect(menu.className).toContain("data-[state=open]:fade-in-0");
    expect(menu.className).toContain("data-[state=open]:zoom-in-95");
    expect(menu.className).toContain("data-[state=closed]:animate-out");
    expect(menu.className).toContain("data-[state=closed]:fade-out-0");
    expect(menu.className).toContain("data-[state=closed]:zoom-out-95");
    expect(menu.className).toContain("slide-in-from-top-2");
  });

  it("max-height uses the Radix CSS variable (set by size middleware)", () => {
    renderOpenDropdown();
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain(
      "max-h-[var(--radix-dropdown-menu-content-available-height)]"
    );
  });

  it("renders via Radix Popper (data-radix-popper-content-wrapper exists)", () => {
    renderOpenDropdown();
    const menu = screen.getByRole("menu");
    const wrapper = menu.closest("[data-radix-popper-content-wrapper]");
    expect(wrapper).toBeInTheDocument();
  });
});
