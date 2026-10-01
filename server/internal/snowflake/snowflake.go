package snowflake

import (
	"github.com/bwmarrin/snowflake"
)

var node *snowflake.Node

// Init creates Node(1). Must be called once at startup.
func Init() error {
	n, err := snowflake.NewNode(1)
	if err != nil {
		return err
	}
	node = n
	return nil
}

// Generate returns a unique 64-bit ID. Falls back to timestamp-based
// generation only if Init was skipped (tests); production calls Init.
func Generate() int64 {
	if node == nil {
		n, err := snowflake.NewNode(1)
		if err != nil {
			return 0
		}
		node = n
	}
	return node.Generate().Int64()
}
