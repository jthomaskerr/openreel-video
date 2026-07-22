import * as React from "react";

export interface InspectorTabPanelProps {
  tab: string;
  active: string;
  labelledByTab?: boolean;
  children: React.ReactNode;
}

export const InspectorTabPanel: React.FC<InspectorTabPanelProps> = ({ tab, active, labelledByTab = false, children }) =>
  active === tab ? (
    <div id={`inspector-panel-${tab}`} role="tabpanel" aria-labelledby={`inspector-tab-${tab}`}>
      {children}
    </div>
  ) : (
    <div
      id={`inspector-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={labelledByTab ? `inspector-tab-${tab}` : undefined}
      hidden
    />
  );
