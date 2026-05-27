"use client";

import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

export function PageHero({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[5px]"
          style={{ background: "#212121", border: "1px solid #353535" }}
        >
          <Icon className="h-5 w-5" style={{ color: "#f36458" }} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="text-sm" style={{ color: "#797979" }}>{description}</p>
        </div>
      </div>
      {action}
    </motion.div>
  );
}
