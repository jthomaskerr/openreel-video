import { useState } from "react";
import type { MediaItem } from "@openreel/core";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  ScrollArea,
} from "@openreel/ui";
import { InfoTab } from "./asset-manager/InfoTab";
import { VersionsTab } from "./asset-manager/VersionsTab";

interface AssetManagerDialogProps {
  open: boolean;
  item: MediaItem;
  onClose: () => void;
}

export function AssetManagerDialog({ open, item, onClose }: AssetManagerDialogProps) {
  const [activeTab, setActiveTab] = useState<string>("info");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold truncate">
            {item.title || item.name}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Manage metadata, versions, and tags for this asset.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="shrink-0">
            <TabsTrigger value="info" className="text-xs">Info</TabsTrigger>
            <TabsTrigger value="versions" className="text-xs">Versions</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="flex-1 min-h-0 mt-3">
            <ScrollArea className="h-full">
              <InfoTab item={item} onClose={onClose} />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="versions" className="flex-1 min-h-0 mt-3">
            <ScrollArea className="h-full">
              <VersionsTab item={item} onClose={onClose} />
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}