/**
 * Code transformation utilities for Sandpack preview
 */

// Wrap code in a default export if it doesn't have one
export function ensureDefaultExport(code: string): string {
    // Check if code already has a default export
    if (/export\s+default\s+/.test(code)) {
        return code;
    }

    // Check for function component declarations
    const functionMatch = code.match(
        /(?:export\s+)?(?:function|const)\s+(\w+)\s*(?::|=)/
    );

    if (functionMatch) {
        const componentName = functionMatch[1];
        // Check if it looks like a React component (PascalCase)
        if (/^[A-Z]/.test(componentName)) {
            // Add default export at the end
            return `${code}\n\nexport default ${componentName};`;
        }
    }

    // Wrap in App component if no component found
    return `export default function App() {
  return (
    <div className="p-8 bg-[#F9F6F0] min-h-screen">
      ${code}
    </div>
  );
}`;
}

// Convert TypeScript to JavaScript (basic transformation)
export function stripTypeScript(code: string): string {
    // Remove type annotations
    const result = code
        // Remove interface declarations
        .replace(/interface\s+\w+\s*\{[^}]*\}/g, '')
        // Remove type declarations
        .replace(/type\s+\w+\s*=[^;]+;/g, '')
        // Remove generic type parameters
        .replace(/<[A-Z][^>]*>/g, '')
        // Remove type annotations in function params
        .replace(/:\s*\w+(?:\[\])?(?:\s*\|\s*\w+)*/g, '')
        // Remove 'as' type assertions
        .replace(/\s+as\s+\w+(?:\[\])?/g, '')
        // Clean up double commas that may result
        .replace(/,\s*,/g, ',')
        // Clean up empty params
        .replace(/\(\s*,/g, '(')
        .replace(/,\s*\)/g, ')');

    return result;
}

// Format code for display (basic indentation fix)
export function formatCode(code: string): string {
    return code
        .replace(/^\s+/gm, (match) => {
            // Normalize to 2-space indentation
            const spaces = match.replace(/\t/g, '  ').length;
            return '  '.repeat(Math.floor(spaces / 2));
        })
        .trim();
}

// Extract component name from code
export function extractComponentName(code: string): string | null {
    // Match function Component or const Component
    const match = code.match(
        /(?:export\s+)?(?:function|const)\s+([A-Z]\w*)\s*(?:\(|=)/
    );
    return match ? match[1] : null;
}

// Check if code contains JSX
export function containsJSX(code: string): boolean {
    return /<[A-Z][^>]*>/.test(code) || /<\/[A-Z]/.test(code);
}

// Transform component props to be more interactive
export function makeInteractive(code: string): string {
    // Add useState if not present and there are event handlers
    if (/onClick|onChange|onSubmit/.test(code) && !/useState/.test(code)) {
        return `import { useState } from 'react';\n\n${code}`;
    }
    return code;
}

// Process code for Sandpack
export function processForSandpack(code: string): string {
    let processed = code;

    // Strip TypeScript if needed
    if (/:\s*(string|number|boolean|any|void|React\.\w+)/.test(code)) {
        processed = stripTypeScript(processed);
    }

    // Ensure default export
    processed = ensureDefaultExport(processed);

    // Make interactive
    processed = makeInteractive(processed);

    // Format
    processed = formatCode(processed);

    return processed;
}
