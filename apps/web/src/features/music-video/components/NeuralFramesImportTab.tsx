import { forwardRef, useImperativeHandle, useRef } from "react";
import { importNeuralFramesFile } from "../neuralframes-import";

export interface NeuralFramesImportTabHandle {
  openFilePicker: () => void;
}

interface Props {
  openreelProjectId: string;
  orchestratorUrl: string;
  onImported?: () => void;
}

export const NeuralFramesImportTab = forwardRef<NeuralFramesImportTabHandle, Props>(
  ({ openreelProjectId, orchestratorUrl, onImported }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      openFilePicker: () => {
        inputRef.current?.click();
      },
    }));

    return (
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void importNeuralFramesFile(file, { orchestratorUrl, openreelProjectId })
              .then(() => onImported?.())
              .catch((err) => console.error("[NeuralFramesImport]", err));
          }
          e.target.value = "";
        }}
      />
    );
  },
);

NeuralFramesImportTab.displayName = "NeuralFramesImportTab";
