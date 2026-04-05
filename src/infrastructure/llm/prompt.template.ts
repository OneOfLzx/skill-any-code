// ===== Three-step protocol: single file =====
/** Step 1: Extract structure only (classes / globals / functions). No summary/description/basic info. */
export const FILE_STRUCTURE_PROMPT = `
# Task: Precise Code Symbol Analysis and Summary
Analyze the provided code file in its entirety, then generate a structured summary of all key symbols (classes, global variables, global functions, structs) with **accurate, concise, and contextually relevant** one-line descriptions.

## Output Requirements
1. Language: Strictly English (no other languages allowed).
2. Format: Loose Markdown / plain text (human-readable, no complex nested syntax except for class details).
3. Accuracy: Ensure all descriptions match the actual functionality/purpose of the symbol in the code; avoid assumptions or generic statements (e.g., "does something" is forbidden).
4. Completeness: Include ALL symbols in the categories below (if none exist in a category, omit that category entirely; if no symbols exist at all, output an empty string).

## Critical Context for Analysis
1. The code file may contain **function implementations without explicit class definitions** (e.g., C++ .cpp files where functions are logically bound to a class but only show implementations, or code from other languages like C/Java with standalone functions).
2. For such functions, analyze function naming conventions (e.g., XXXModule, XXXModule::Free), file naming, comment context, and parameter/return types to **infer the logical class/module they belong to**.
3. This analysis applies to all programming languages (not limited to C++), focus on semantic/logical association rather than syntax.

## Symbols to Analyze (exhaustive list)
- Class definitions (including template classes, abstract classes, nested classes)
- Global variables (including constants, typedefs for global variables, static global variables)
- Global functions (including free functions, template functions, static global functions; exclude class methods here)
- Structs (broad definition: structs, typedef structs, anonymous structs, template structs, union-struct hybrids, struct aliases)

## Formatting Rules (MANDATORY, follow exactly)
### 1. Global Function Entry (one line per function)
- Format: [access modifier (public/private/static) if applicable] [return type] [function name]([parameter list]) - [one-line brief: what the function does, its core purpose, or return value meaning]
- Example: public camera_metadata_t* CreateMetadata(SIZE_T entryCapacity, SIZE_T dataCapacity) - Allocates and creates a new camera metadata structure with specified entry and data capacities.

### 2. Struct Entry (one line per struct)
- Format: struct [struct name] - [one-line brief: core purpose/what the struct stores/represents (one complete sentence)]
- Example: struct Foo - Stores key-value pairs for camera configuration parameters.
- Notes: For anonymous structs: anonymous struct - Holds temporary sensor data during metadata processing.; for template structs: template struct Bar<T> - Generic container for type T camera metadata entries.

### 3. Class Entry (nested list format)
- First line: class [class name] - [one-line brief: core responsibility/purpose of the class]
- Optional nested bullets (only if class has fields/methods; one line per field/method):
  - Field: ([type]) [field name] - [brief description of what the field stores]
  - Method: [access modifier (public/private/static) if applicable] [return type] [function name]([parameter list])  - [brief description of what the method does]
- Example:
  - class CameraMetadataManager - Manages lifecycle and modification of camera metadata structures.
    - Field:
      - (camera_metadata_t*) m_metadata - Pointer to the active metadata structure.
    - Method:
      - public void UpdateEntry(int entryId, void* data) - Updates a specific metadata entry with new data.

### 4. Global Variable Entry (one line per variable)
- Format: ([type]) [variable name] - [one-line brief: purpose/what the variable represents/stores]
- Example: (const SIZE_T) global g_MaxMetadataEntries - Defines the maximum allowed entries in a camera metadata structure.

## Input Code File
File path: {{filePath}}
Code content:
{{fileContent}}

## Final Check
- Ensure no symbols are missed (scan the code line-by-line for the specified symbol types).
- Ensure descriptions are **specific** (avoid vague language like "handles data" – specify WHAT data, HOW it's handled).
- Ensure formatting strictly follows the rules above (no extra lines, no inconsistent indentation).
- If no symbols are confidently identified, output an empty string (do not output "no symbols found" or similar).
`;

/** Step 2: Generate description only (<= 200 words) */
export const FILE_DESCRIPTION_PROMPT = `
Describe the overall purpose of the code in <= 200 words.

Input (either fileContent or mergedChunksText will be provided):
{{fileContent}}
{{mergedChunksText}}

Constraints:
- Output language: English
- Output ONLY the description text.
`;

/** Step 3: Generate summary only (<= 100 words) */
export const FILE_SUMMARY_PROMPT = `
Based on the symbols and description below, write a concise high-level summary in <= 100 words.

Output language: English.

Symbols:
{{symbols}}

Description:
{{description}}

Output ONLY the summary text (no quotes, no markdown header).
`;

/** Retry hint when parsing fails (append to original prompt) */
export const PARSE_RETRY_HINT = `

[IMPORTANT] Your previous output did NOT match the required format.
`;

// ===== Merge stage =====
/** Merge step: merge and deduplicate multiple chunk results into ONE Symbols section */
export const MERGE_STRUCTURE_PROMPT = `
Below are merged analysis results for multiple chunks of the same file.
Deduplicate and merge them into ONE complete Symbols section (classes / global variables / global functions / structs).

Output language: English.

File path: {{filePath}}
Merged chunk text:
{{mergedChunksText}}

## Critical Context for Analysis
1. The code file may contain **function implementations without explicit class definitions** (e.g., C++ .cpp files where functions are logically bound to a class but only show implementations, or code from other languages like C/Java with standalone functions).
2. For such functions, analyze function naming conventions (e.g., XXXModule, XXXModule::Free), file naming, comment context, and parameter/return types to **infer the logical class/module they belong to**.
3. This analysis applies to all programming languages (not limited to C++), focus on semantic/logical association rather than syntax.

## Formatting Rules (MANDATORY, follow exactly)
### 1. Global Function Entry (one line per function)
- Format: [access modifier (public/private/static) if applicable] [return type] [function name]([parameter list]) - [one-line brief: what the function does, its core purpose, or return value meaning]
- Example: public camera_metadata_t* CreateMetadata(SIZE_T entryCapacity, SIZE_T dataCapacity) - Allocates and creates a new camera metadata structure with specified entry and data capacities.

### 2. Struct Entry (one line per struct)
- Format: struct [struct name] - [one-line brief: core purpose/what the struct stores/represents (one complete sentence)]
- Example: struct Foo - Stores key-value pairs for camera configuration parameters.
- Notes: For anonymous structs: anonymous struct - Holds temporary sensor data during metadata processing.; for template structs: template struct Bar<T> - Generic container for type T camera metadata entries.

### 3. Class Entry (nested list format)
- First line: class [class name] - [one-line brief: core responsibility/purpose of the class]
- Optional nested bullets (only if class has fields/methods; one line per field/method):
  - Field: ([type]) [field name] - [brief description of what the field stores]
  - Method: [access modifier (public/private/static) if applicable] [return type] [function name]([parameter list])  - [brief description of what the method does]
- Example:
  - class CameraMetadataManager - Manages lifecycle and modification of camera metadata structures.
    - Field:
      - (camera_metadata_t*) m_metadata - Pointer to the active metadata structure.
    - Method:
      - public void UpdateEntry(int entryId, void* data) - Updates a specific metadata entry with new data.

### 4. Global Variable Entry (one line per variable)
- Format: ([type]) [variable name] - [one-line brief: purpose/what the variable represents/stores]
- Example: (const SIZE_T) global g_MaxMetadataEntries - Defines the maximum allowed entries in a camera metadata structure.
`;

// ===== Directory two-step protocol =====
/** Directory step 1: generate description (<= 200 words) */
export const DIRECTORY_DESCRIPTION_PROMPT = `
You are a codebase structure analysis assistant. Below is a JSON list of all direct child directories and files (with brief summaries).
Write an English paragraph (<= 200 words) describing the directory's role and responsibilities in the project.

Output ONLY the description text.

Children (JSON):
{{childrenJson}}
`;

/** Directory step 2: generate summary (<= 100 words) */
export const DIRECTORY_SUMMARY_PROMPT = `
Based on the directory description and children JSON below, write a one-sentence high-level summary in English (<= 100 words).
Focus on the big picture and avoid details.

Output ONLY the summary text.

Directory description:
{{description}}

Children (JSON):
{{childrenJson}}
`;

export const CODE_ANALYSIS_PROMPT = `
(Deprecated legacy prompt. Kept empty for backward compatibility; not used in the main pipeline.)
`;

export const CHUNK_ANALYSIS_PROMPT = `
# Task: Precise Code Symbol Analysis and Summary
You will be provided with a code chunk from a code file.
Analyze the provided code chunk, then generate a structured summary of all key symbols (classes, global variables, global functions, structs) with **accurate, concise, and contextually relevant** one-line descriptions.

Analyze the following code chunk and output BOTH:
1) Chunk Description (<= 200 words): what this chunk does/provides.
2) Chunk Symbols (loose Markdown / plain text): all classes / global variables / global functions / structs that are confidently present in THIS chunk.

Output language: English.

Do not guess beyond the visible content in this chunk.

File path: {{filePath}}
Chunk ID: {{chunkId}}
Chunk content:
{{chunkContent}}

Suggested plain text format:
Chunk Description:
<200 words max>

Symbols:
<symbols entries>
## Formatting Rules (MANDATORY, follow exactly)
### 1. Global Function Entry (one line per function)
- Format: [access modifier (public/private/static) if applicable] [return type] [function name]([parameter list]) - [one-line brief: what the function does, its core purpose, or return value meaning]
- Example: public camera_metadata_t* CreateMetadata(SIZE_T entryCapacity, SIZE_T dataCapacity) - Allocates and creates a new camera metadata structure with specified entry and data capacities.

### 2. Struct Entry (one line per struct)
- Format: struct [struct name] - [one-line brief: core purpose/what the struct stores/represents (one complete sentence)]
- Example: struct Foo - Stores key-value pairs for camera configuration parameters.
- Notes: For anonymous structs: anonymous struct - Holds temporary sensor data during metadata processing.; for template structs: template struct Bar<T> - Generic container for type T camera metadata entries.

### 3. Class Entry (nested list format)
- First line: class [class name] - [one-line brief: core responsibility/purpose of the class]
- Optional nested bullets (only if class has fields/methods; one line per field/method):
  - Field: ([type]) [field name] - [brief description of what the field stores]
  - Method: [access modifier (public/private/static) if applicable] [return type] [function name]([parameter list])  - [brief description of what the method does]
- Example:
  - class CameraMetadataManager - Manages lifecycle and modification of camera metadata structures.
    - Field:
      - (camera_metadata_t*) m_metadata - Pointer to the active metadata structure.
    - Method:
      - public void UpdateEntry(int entryId, void* data) - Updates a specific metadata entry with new data.

### 4. Global Variable Entry (one line per variable)
- Format: ([type]) [variable name] - [one-line brief: purpose/what the variable represents/stores]
- Example: (const SIZE_T) global g_MaxMetadataEntries - Defines the maximum allowed entries in a camera metadata structure.

## Critical Context for Analysis
1. The code file may contain **function implementations without explicit class definitions** (e.g., C++ .cpp files where functions are logically bound to a class but only show implementations, or code from other languages like C/Java with standalone functions).
2. For such functions, analyze function naming conventions (e.g., XXXModule, XXXModule::Free), file naming, comment context, and parameter/return types to **infer the logical class/module they belong to**.
3. This analysis applies to all programming languages (not limited to C++), focus on semantic/logical association rather than syntax.
`;
