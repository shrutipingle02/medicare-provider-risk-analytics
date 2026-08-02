"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/* A type-to-filter dropdown. The specialty list runs to 113 entries, which a
   native <select> turns into a scrolling wall — you cannot find "Interventional
   Pain Management" without already knowing it is there. */
export default function FilterCombobox({
  label,
  options,
  value,
  onChange,
  allLabel,
  className,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
  allLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Base UI composes through `render`, not Radix's `asChild`: the
          trigger's own props are merged into the element handed to it. */}
      <PopoverTrigger
        aria-label={label}
        render={
          <Button
            variant="outline"
            className={cn(
              "justify-between font-normal bg-[var(--surface)]",
              !value && "text-[var(--ink-secondary)]",
              className,
            )}
          />
        }
      >
        <span className="truncate">{value || allLabel}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={allLabel}
                onSelect={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value === "" ? "opacity-100" : "opacity-0",
                  )}
                />
                {allLabel}
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={(picked) => {
                    onChange(picked === value ? "" : option);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
