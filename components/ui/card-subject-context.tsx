"use client";

import { createContext } from "react";
import type { DemandSubjectType } from "@/components/demand/demand-pill";

export const CardSubjectContext = createContext<{ type: DemandSubjectType; id: string } | null>(null);
