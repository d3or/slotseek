import dotenv from "dotenv";

dotenv.config({ path: ".env" });

if (!process.env.BASE_RPC_URL || !process.env.ETH_RPC_URL) {
  throw new Error("RPC_URL is not set in the environment");
}
