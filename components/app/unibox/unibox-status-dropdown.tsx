"use client";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "1", label: "Interested" },
  { value: "2", label: "Meeting booked" },
  { value: "3", label: "Meeting completed" },
  { value: "4", label: "Won" },
  { value: "0", label: "Out of office" },
  { value: "-1", label: "Not interested" },
  { value: "-2", label: "Wrong person" },
  { value: "-3", label: "Lost" },
];

type Props = {
  interestStatus: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
};

export function UniboxStatusDropdown({ interestStatus, onChange, disabled }: Props) {
  const current = interestStatus === null ? "lead" : String(interestStatus);

  return (
    <Select
      value={current}
      disabled={disabled}
      onValueChange={(v) => {
        if (v === "lead") onChange(null);
        else onChange(Number(v));
      }}
    >
      <SelectTrigger className="h-8 w-[180px] text-xs">
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
