/** @type {import('next').NextConfig} */
const nextConfig = {
  // No effector babel/SWC plugin anywhere: effector-refetch's public stores ship
  // with explicit stable sids, so serialize(scope) works out of the box. Add
  // @effector/swc-plugin only if YOUR OWN stores need to travel server -> client.
};

export default nextConfig;
