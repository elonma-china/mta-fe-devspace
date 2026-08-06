#!/bin/sh

# Path where the static React files are located in the container
OUTPUT_FILE="/app/build/env-config.js"

# Generate the JS file
echo "window._env_ = {" > $OUTPUT_FILE
echo "  REACT_APP_DB_HOST: \"$REACT_APP_DB_HOST\"," >> $OUTPUT_FILE
echo "  REACT_APP_FILE_EXT: \"$REACT_APP_FILE_EXT\"," >> $OUTPUT_FILE
echo "  REACT_APP_TOOL_PREFIX: \"$REACT_APP_TOOL_PREFIX\"," >> $OUTPUT_FILE
echo "  REACT_APP_LLM_PREFIX: \"$REACT_APP_LLM_PREFIX\"," >> $OUTPUT_FILE
echo "  REACT_APP_MAX_FILES: \"$REACT_APP_MAX_FILES\"," >> $OUTPUT_FILE
echo "  REACT_APP_MAX_TOTAL_SIZE_MB: \"$REACT_APP_MAX_TOTAL_SIZE_MB\"" >> $OUTPUT_FILE
echo "};" >> $OUTPUT_FILE

echo "Configuration injected into $OUTPUT_FILE"

# Execute the passed command (starts the server)
exec "$@"