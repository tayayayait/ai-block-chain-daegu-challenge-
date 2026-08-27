import { render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

type MockItemComponent = ComponentType<{
  children: ReactNode;
  index: number;
  style: React.CSSProperties;
}>;

vi.mock("virtua", () => ({
  Virtualizer: ({
    as: Container = "div",
    item: Item = "div",
    data = [],
    children,
  }: {
    as?: ComponentType<{ children: ReactNode }> | string;
    item?: MockItemComponent | string;
    data?: ArrayLike<unknown>;
    children: (row: unknown, index: number) => React.ReactElement;
  }) => {
    const ContainerElement = Container as ComponentType<{
      children: ReactNode;
      "data-testid": string;
    }>;
    const ItemElement = Item as ComponentType<{
      children: ReactNode;
      index: number;
      style: React.CSSProperties;
    }>;
    const visible = Array.from(data).slice(0, 10);

    return (
      <ContainerElement data-testid="virtua-virtualizer">
        {visible.map((row, index) => (
          <ItemElement key={index} index={index} style={{ height: "56px" }}>
            {children(row, index)}
          </ItemElement>
        ))}
      </ContainerElement>
    );
  },
}));

import { DataTable, type DataTableColumn } from "./DataTable";

interface Row {
  id: string;
  name: string;
  hri: number;
}

const columns: DataTableColumn<Row>[] = [
  { id: "name", label: "대상자", render: (row) => row.name },
  { id: "hri", label: "HRI", numeric: true, sortKey: "hri", render: (row) => row.hri },
];

describe("DataTable", () => {
  it("정렬 상태를 URL에 반영하고 각 행을 실제 링크로 제공한다", () => {
    render(
      <DataTable
        caption="대상자 위험도"
        columns={columns}
        rows={[
          { id: "s1", name: "김○○", hri: 72 },
          { id: "s2", name: "박○○", hri: 55 },
        ]}
        getRowKey={(row) => row.id}
        getRowHref={(row) => `/subjects/${row.id}`}
        getRowLabel={(row) => `${row.name} 상세`}
        sort={{ key: "hri", order: "asc" }}
        sortBaseHref="/subjects?gu=수성구"
      />,
    );

    const table = screen.getByRole("table", { name: "대상자 위험도" });
    expect(within(table).getByRole("link", { name: "HRI 내림차순 정렬" })).toHaveAttribute(
      "href",
      "/subjects?gu=%EC%88%98%EC%84%B1%EA%B5%AC&sort=hri&order=desc",
    );
    expect(within(table).getByRole("link", { name: "김○○ 상세" })).toHaveAttribute(
      "href",
      "/subjects/s1",
    );
    expect(within(table).getByText("72").closest("td")).toHaveClass("num", "text-right");
  });

  it("50행을 초과하면 고정 56px 행의 가상 창만 렌더한다", () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `s${index}`,
      name: `대상자 ${index}`,
      hri: index,
    }));
    render(
      <DataTable
        caption="대상자 51명"
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        getRowHref={(row) => `/subjects/${row.id}`}
        getRowLabel={(row) => `${row.name} 상세`}
      />,
    );

    const table = screen.getByRole("table", { name: "대상자 51명" });
    expect(table).toHaveAttribute("data-virtualized", "true");
    expect(within(table).getByTestId("virtua-virtualizer")).toBeInTheDocument();
    expect(within(table).getAllByRole("row").length).toBeLessThan(52);
    expect(within(table).getAllByRole("row")[1]).toHaveStyle({ height: "56px" });
  });
});
