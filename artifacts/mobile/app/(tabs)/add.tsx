/**
 * Add tab route shim.
 *
 * expo-router registers every file under app/ as a route, so the Add screen
 * lives in components/add/ (split into index/PetChip/styles) and this file
 * only re-exports it. See components/add/index.tsx.
 */
export { default } from '@/components/add';
