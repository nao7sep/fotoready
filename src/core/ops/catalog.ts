/**
 * Importing the catalog registers every op module exactly once. Add new ops to this list;
 * the registry will throw if the same op type is registered twice.
 */
import "./crop";
import "./rotate";
import "./flip";
import "./resize";
import "./levels";
import "./white-balance";
import "./auto-tone";
import "./curves";
import "./hsl";
import "./unsharp-mask";
import "./denoise";
import "./lut";
import "./cover";
import "./blur";
import "./mosaic";
import "./watermark-text";
import "./watermark-image";
import "./strip-metadata";
import "./inject-metadata";

export {
  getOpDefinition,
  getOpModule,
  listOpDefinitions,
  listOpModules,
  requireOpModule
} from "./registry";

export type { OpModule, OpApplyContext, MetadataDecision, ImageFrame } from "./op-module";
