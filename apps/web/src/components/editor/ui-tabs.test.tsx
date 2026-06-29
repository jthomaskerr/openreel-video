import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@openreel/ui";

describe("shared TabsContent", () => {
  it("renders active panel children", () => {
    render(
      <Tabs value="info" onValueChange={() => undefined}>
        <TabsList>
          <TabsTrigger value="info">Info</TabsTrigger>
        </TabsList>
        <TabsContent value="info">
          <div>Asset info panel</div>
        </TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("Asset info panel")).toBeInTheDocument();
  });
});
