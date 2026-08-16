import { beginCell, type Cell } from "@ton/core";
import {
  FLAG_CARRY,
  FLAG_ZERO,
  NIBBLE_MASK,
  OUTPUT_COMMITMENT_DOMAIN,
  RAM_SIZE,
  REGISTER_COUNT,
  STATUS_HALTED,
  STATUS_RUNNING,
} from "./constants.js";

