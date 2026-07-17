import * as React from "react";

export interface InspectorTabPanelProps {
  tab: string;
  active: string;
  children: React.ReactNode;
}

export const InspectorTabPanel: React.FC<InspectorTabPanelProps> = ({ tab, active, children }) =>
  active === tab ? (
    <div id={`inspector-panel-${tab}`} role="tabpanel" aria-labelledby={`inspector-tab-${tab}`}>
      {children}
    </div>
  ) : (
    <div
      id={`inspector-panel-${tab}`}
      role="tabpanel"
      hidden
    />
  );
