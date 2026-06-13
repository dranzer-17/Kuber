"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApolloForm, ExcelForm, ManualForm } from "@/components/app/lead-forms";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AddLeadsDrawerProps {
  open: boolean;
  onClose: () => void;
  onImport: (count: number) => void;
}

export function AddLeadsDrawer({ open, onClose, onImport }: AddLeadsDrawerProps) {
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleImport(count: number) {
    onImport(count);
    onClose();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div className={cn(
        "fixed top-0 right-0 z-50 h-full w-[560px] max-w-[95vw] bg-card border-l border-border shadow-2xl",
        "flex flex-col transition-transform duration-300 ease-in-out",
        open ? "translate-x-0" : "translate-x-full",
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-bold">Add Leads</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Source leads via Apollo, Excel, or manual entry.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-secondary"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <Tabs defaultValue="apollo" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="apollo">Apollo Search</TabsTrigger>
              <TabsTrigger value="excel">Excel / CSV</TabsTrigger>
              <TabsTrigger value="manual">Manual Entry</TabsTrigger>
            </TabsList>
            <div className="rounded-xl border border-border bg-secondary/20 p-5">
              <TabsContent value="apollo" className="mt-0">
                <ApolloForm onImport={handleImport} />
              </TabsContent>
              <TabsContent value="excel" className="mt-0">
                <ExcelForm onImport={handleImport} />
              </TabsContent>
              <TabsContent value="manual" className="mt-0">
                <ManualForm onImport={handleImport} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </>
  );
}
