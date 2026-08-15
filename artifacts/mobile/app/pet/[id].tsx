/**
 * Pet Profile — pet's profile screen.
 *
 * Data comes from GET /pets/:id via useGetPet(id).
 * Displays packCount + viewerInPack (server-backed via AddToPackLink).
 * Species/breed chips are tappable follows (server-backed via InterestChip).
 * Boop/treat aggregate totals are summed across all posts from the server.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useColumnWidth } from "@/hooks/useColumnWidth";
import * as ImagePicker from "expo-image-picker";
import MediaImage from "@/components/MediaImage";
import FocalImage from "@/components/FocalImage";
import CropEditor from "@/components/CropEditor";
import type { CropRect } from "@/utils/computeAutoFrame";
import { useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Camera, PencilSimple, Heart, Star, SquaresFour } from 'phosphor-react-native';
import Svg, { Path } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import {
  useGetPet,
  useGetPetPackMembers,
  useFollowSpecies,
  useUnfollowSpecies,
  useFollowBreed,
  useUnfollowBreed,
  useDeletePost,
  usePatchPost,
  useArchivePost,
  useUnarchivePost,
  usePatchPetAvatar,
  usePresignAvatarUpload,
  useVerifyUpload,
  useGetMyPets,
  useAddPostPetTag,
  useRemovePostPetTag,
  useSearchPets,
  getSearchPetsQueryKey,
  getGetFeedQueryKey,
  getGetPetQueryKey,
  getGetMyPetsQueryKey,
  getGetMyFollowsQueryKey,
  customFetch,
  useGetPetCoOwnershipRequests,
  getGetPetCoOwnershipRequestsQueryKey,
} from "@workspace/api-client-react";
import type { FeedPost, PackResult } from "@workspace/api-client-react";
import { useAuth } from "@clerk/clerk-expo";
import { resolveMediaKey } from "@/utils/mediaKey";
import { formatCount } from "@/utils/formatCount";
import { compressImage } from "@/utils/compressImage";
import { maybeConvertHeic } from "@/utils/maybeConvertHeic";
import AddToPackLink from "@/components/AddToPackLink";
import InterestChip from "@/components/InterestChip";
import { useFollowsContext } from "@/context/FollowsContext";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const HERO_HEIGHT = SCREEN_HEIGHT * 0.42;
// GRID_ITEM_SIZE computed dynamically inside component using useColumnWidth() so
// it respects the 430-px web column rather than the full window width.

/** Filled paw icon for the Pack stat cell. */
function PawStatIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      <Path d="M7.2 7.24a1.9 1.9 0 0 0-1.9 2.4c.19.98 1.04 1.7 2.09 1.52A2.19 2.19 0 0 0 9.1 9.4a1.9 1.9 0 0 0-1.9-2.16zm9.6 0a1.9 1.9 0 0 0-1.9 2.16 2.19 2.19 0 0 0 1.71 1.76c1.05.18 1.9-.54 2.09-1.52a1.9 1.9 0 0 0-1.9-2.4zM10 4.1a1.8 1.8 0 0 0-1.8 2.3 2.11 2.11 0 0 0 1.64 1.7c1.02.17 1.83-.52 1.96-1.5A1.8 1.8 0 0 0 10 4.1zm4 0a1.8 1.8 0 0 0-1.8 2.5c.13.98.94 1.67 1.96 1.5A2.11 2.11 0 0 0 15.8 6.4 1.8 1.8 0 0 0 14 4.1zM12 11c-2.6 0-4.9 2-4.9 4.3 0 1.6 1.2 2.7 2.8 2.7 1 0 1.5-.4 2.1-.4s1.1.4 2.1.4c1.6 0 2.8-1.1 2.8-2.7C16.9 13 14.6 11 12 11Z" />
    </Svg>
  );
}

export default function PetProfileScreen() {
  const colors      = useColors();
  const insets      = useSafeAreaInsets();
  const columnWidth = useColumnWidth();
  const gridItemSize = (columnWidth - 4) / 3;
  const { id: rawId } = useLocalSearchParams();
  const petId = Array.isArray(rawId) ? rawId[0] : rawId;

  const { data: pet, isLoading, isError } = useGetPet(petId ?? "");
  const { userId: myUserId } = useAuth();

  // Person-level report/block moved to the public profile screen — owner
  // names below link there instead of carrying an inline report whisper.

  const [selectedPostId,  setSelectedPostId]  = useState<string | null>(null);
  const [packMembersOpen, setPackMembersOpen] = useState(false);
  // Local pack count — initialised from server, updated optimistically on toggle
  const [localPackCount, setLocalPackCount] = useState<number | null>(null);
  // Delete-confirm, archive-confirm, and edit states for the post modal
  const [deleteConfirm,    setDeleteConfirm]    = useState(false);
  const [archiveConfirm,   setArchiveConfirm]   = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [isEditMode,       setIsEditMode]       = useState(false);
  const [draftCaption,     setDraftCaption]     = useState("");
  const [draftIsNursery,   setDraftIsNursery]   = useState(false);
  // Pet-tagging state inside the Edit Post form
  const [editTagSearch,    setEditTagSearch]    = useState("");
  const [editRemovingId,   setEditRemovingId]   = useState<string | null>(null);
  const [editAddingId,     setEditAddingId]     = useState<string | null>(null);

  // ── Pending co-ownership request (invitee view) ──────────────────────────
  // A pending request means someone wants to share this pet with the viewer.
  const [myPendingInvite, setMyPendingInvite] = useState<{
    id: string; inviterUsername: string; petName: string;
  } | null>(null);
  const [inviteActing, setInviteActing] = useState(false);

  // ── Incoming join requests (owner view — search-before-create flow) ───────
  const [joinRequests, setJoinRequests] = useState<Array<{
    id: string; requesterUsername: string; requesterDisplayName?: string | null;
  }>>([]);
  const [joinActingId, setJoinActingId] = useState<string | null>(null);

  // ── Co-owner invite state (owner view — add co-owner form on profile) ────
  const [coOwnerOpen,     setCoOwnerOpen]     = useState(false);
  const [coOwnerUsername, setCoOwnerUsername] = useState('');
  const [coOwnerSending,  setCoOwnerSending]  = useState(false);
  const [coOwnerError,    setCoOwnerError]    = useState<string | null>(null);
  const [coOwnerSent,     setCoOwnerSent]     = useState(false);
  const [cancellingId,    setCancellingId]    = useState<string | null>(null);

  // ── Self-removal state (co-owner leaves a shared pet) ─────────────────────
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveError,   setLeaveError]   = useState<string | null>(null);

  // ── Avatar edit flow ───────────────────────────────────────────────────────
  // Multi-step: sheet → (postPicker | compressing) → framing → saving
  type AvatarStep = "idle" | "sheet" | "postPicker" | "compressing" | "framing" | "saving";
  const [avatarStep,    setAvatarStep]    = useState<AvatarStep>("idle");
  const [avatarUri,     setAvatarUri]     = useState<string | null>(null);
  // mediaKey of the source post when "choose from posts" was selected.
  const [avatarSrcKey,  setAvatarSrcKey]  = useState<string | null>(null);
  const avatarNatural = useRef({ width: 0, height: 0 });
  const [avatarError,   setAvatarError]   = useState<string | null>(null);

  const queryClient = useQueryClient();

  // Delete mutation — invalidates pet grid, Home feed, and Nursery feed on success
  const { mutate: doDelete, isPending: isDeleting } = useDeletePost({
    mutation: {
      onSuccess: () => {
        setSelectedPostId(null);
        setDeleteConfirm(false);
        setIsEditMode(false);
        queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(petId ?? "") });
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey({ nursery: true }) });
      },
    },
  });

  // Edit mutation — patches caption/isNursery; updates cache immediately then
  // invalidates so the grid, Home feed, and Nursery feed all reflect the change.
  const { mutate: doEdit, isPending: isSaving } = usePatchPost({
    mutation: {
      onSuccess: (data) => {
        // Write new values into the cached pet profile so view mode is instant
        queryClient.setQueryData(getGetPetQueryKey(petId ?? ""), (old: any) => {
          if (!old) return old;
          return {
            ...old,
            posts: old.posts.map((p: any) =>
              p.id === selectedPostId
                ? { ...p, caption: data.caption, isNursery: data.isNursery }
                : p,
            ),
          };
        });
        setIsEditMode(false);
        queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(petId ?? "") });
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey({ nursery: true }) });
      },
    },
  });

  // ── Avatar mutations ──────────────────────────────────────────────────────
  const { mutateAsync: presignAvatarUpload } = usePresignAvatarUpload();
  const { mutateAsync: verifyUpload        } = useVerifyUpload();
  const { mutateAsync: patchAvatar, isPending: isSavingAvatar } = usePatchPetAvatar({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(petId ?? "") });
        queryClient.invalidateQueries({ queryKey: getGetMyPetsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyFollowsQueryKey() });
        setAvatarStep("idle");
        setAvatarUri(null);
        setAvatarSrcKey(null);
        setAvatarError(null);
      },
      onError: () => {
        setAvatarError("Could not save avatar. Please try again.");
        setAvatarStep("sheet");
      },
    },
  });

  // Archive / unarchive — both dismiss the modal and re-sync all affected queries
  const { mutate: doArchive, isPending: isArchiving } = useArchivePost({
    mutation: {
      onSuccess: () => {
        setSelectedPostId(null);
        setArchiveConfirm(false);
        queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(petId ?? "") });
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey({ nursery: true }) });
      },
    },
  });

  const { mutate: doUnarchive, isPending: isUnarchiving } = useUnarchivePost({
    mutation: {
      onSuccess: () => {
        setSelectedPostId(null);
        setArchiveConfirm(false);
        queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(petId ?? "") });
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey({ nursery: true }) });
      },
    },
  });

  // ── Pet-tag edit hooks ────────────────────────────────────────────────────
  const { data: myPetsData }                   = useGetMyPets();
  const myOwnPets                              = myPetsData?.pets ?? [];
  const { mutateAsync: addTagMutation }        = useAddPostPetTag();
  const { mutateAsync: removeTagMutation }     = useRemovePostPetTag();

  // selectedPost must be declared BEFORE the hooks that reference it (TDZ guard).
  // Uses optional chaining on pet?.posts because pet may still be loading here.
  const selectedPost: FeedPost | undefined =
    (pet?.posts ?? []).find((p) => p.id === selectedPostId) ??
    (pet?.archivedPosts ?? []).find((p) => p.id === selectedPostId);

  // Search for cross-owner pets to add (only fires when ≥1 char typed)
  const editTagExclude = (selectedPost as any)?.taggedPets?.map((tp: any) => tp.id).join(',') ?? '';
  const { data: editSearchData } = useSearchPets(
    { q: editTagSearch, exclude: editTagExclude },
    { query: { enabled: editTagSearch.trim().length >= 1, queryKey: getSearchPetsQueryKey({ q: editTagSearch, exclude: editTagExclude }) } },
  );
  const editTagSearchResults = (editSearchData?.pets ?? []).filter(
    (r) => !myOwnPets.some((p) => p.id === r.id),
  );

  // Own pets not yet tagged on this post
  const editableOwnPets = myOwnPets.filter(
    (p) => !((selectedPost as any)?.taggedPets ?? []).some((tp: any) => tp.id === p.id),
  );

  const handleEditAddTag = useCallback(async (tagPetId: string) => {
    if (!selectedPostId || editAddingId) return;
    setEditAddingId(tagPetId);
    try {
      await addTagMutation({ id: selectedPostId, petId: tagPetId });
      setEditTagSearch('');
      queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(petId ?? '') });
    } catch {
      // Silent — server error message not surfaced here (keep the modal open)
    } finally {
      setEditAddingId(null);
    }
  }, [selectedPostId, editAddingId, addTagMutation, queryClient, petId]);

  const handleEditRemoveTag = useCallback(async (tagPetId: string) => {
    if (!selectedPostId || editRemovingId) return;
    setEditRemovingId(tagPetId);
    try {
      await removeTagMutation({ id: selectedPostId, petId: tagPetId });
      queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(petId ?? '') });
    } catch {
      // Silent — tag stays visible if request fails
    } finally {
      setEditRemovingId(null);
    }
  }, [selectedPostId, editRemovingId, removeTagMutation, queryClient, petId]);

  // Closing the modal always resets all modal state so it's fresh next open
  const closePostModal = useCallback(() => {
    setSelectedPostId(null);
    setDeleteConfirm(false);
    setArchiveConfirm(false);
    setIsEditMode(false);
    setEditTagSearch('');
  }, []);

  // ── Avatar helpers ─────────────────────────────────────────────────────────

  /** Compress a picked URI + dimensions, then advance to the framing step. */
  const processAvatarAsset = useCallback(async (
    uri: string,
    width: number,
    height: number,
    srcKey?: string,           // mediaKey of the source post (for "choose from posts")
  ) => {
    setAvatarStep("compressing");
    setAvatarError(null);
    try {
      // HEIC/HEIF pre-step: converts to JPEG on web (lazy-loaded decoder);
      // no-op on native where the manipulator decodes HEIC directly.
      const sourceUri  = await maybeConvertHeic(uri);
      const compressed = await compressImage(sourceUri, width, height);
      // The intermediate decoded-JPEG object URL (web HEIC path only) has
      // served its purpose once compression has consumed it — revoke it.
      if (sourceUri !== uri && sourceUri.startsWith("blob:")) {
        URL.revokeObjectURL(sourceUri);
      }
      avatarNatural.current = {
        width:  (compressed as { width?: number }).width  ?? width,
        height: (compressed as { height?: number }).height ?? height,
      };
      setAvatarUri(compressed.uri);
      setAvatarSrcKey(srcKey ?? null);
      setAvatarStep("framing");
    } catch {
      setAvatarError("Couldn't read this photo — the file may be damaged or in a format we can't decode. Please try a different one.");
      setAvatarStep("sheet");
    }
  }, []);

  /** "Choose from posts" — user tapped a post thumbnail in the post picker. */
  const handlePickFromPost = useCallback(async (post: FeedPost) => {
    setAvatarStep("idle"); // close post picker briefly while compressing
    // We need a local URI to feed into CropFramer. Fetch the signed URL and
    // treat it as a URI; also keep the mediaKey for the server-side copy.
    const source = resolveMediaKey(post.mediaKey, post.mediaUrl);
    const uri = typeof source === "object" && "uri" in source
      ? (source as { uri: string }).uri
      : post.mediaUrl ?? post.mediaKey;
    await processAvatarAsset(uri, columnWidth, columnWidth, post.mediaKey);
  }, [processAvatarAsset]);

  /** Camera source. */
  const handleAvatarCamera = useCallback(async () => {
    setAvatarError(null);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      setAvatarError("Camera access is required. Please enable it in Settings.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
      setAvatarError("This photo is too large (max 10 MB). Please choose a smaller one.");
      return;
    }
    await processAvatarAsset(asset.uri, asset.width, asset.height);
  }, [processAvatarAsset]);

  /** Library source. */
  const handleAvatarLibrary = useCallback(async () => {
    setAvatarError(null);
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        setAvatarError("Photo library access is required. Please enable it in Settings.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
      setAvatarError("This photo is too large (max 10 MB). Please choose a smaller one.");
      return;
    }
    await processAvatarAsset(asset.uri, asset.width, asset.height);
  }, [processAvatarAsset]);

  /** Called when CropEditor confirms the framing. Upload if needed, then PATCH. */
  const handleAvatarFrameConfirm = useCallback(async (rect: CropRect, _mode: 'cover' | 'contain') => {
    if (!petId || !avatarUri) return;
    setAvatarStep("saving");
    setAvatarError(null);

    try {
      let mediaKey: string;

      if (avatarSrcKey) {
        // Source was an existing post — server will copy it.
        mediaKey = avatarSrcKey;
      } else {
        // New image from camera or library — upload to avatars/ first.
        const imageResp = await fetch(avatarUri);
        const blob      = await imageResp.blob();
        if (blob.size > 10 * 1024 * 1024) {
          setAvatarError("Image is too large (max 10 MB). Please choose a smaller one.");
          setAvatarStep("sheet");
          return;
        }
        const { uploadUrl, mediaKey: key } = await presignAvatarUpload({
          data: { contentType: "image/jpeg", sizeBytes: blob.size },
        });
        const putRes = await fetch(uploadUrl, {
          method:  "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body:    blob,
        });
        if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

        // Server-side magic-byte check — real security boundary.
        await verifyUpload({ data: { mediaKey: key } });

        mediaKey = key;
      }

      await patchAvatar({
        id:   petId,
        data: {
          avatarKey: mediaKey,
          focusX: null,
          focusY: null,
          cropX: rect.x,
          cropY: rect.y,
          cropW: rect.w,
          cropH: rect.h,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      setAvatarError(msg);
      setAvatarStep("sheet");
    }
  }, [petId, avatarUri, avatarSrcKey, presignAvatarUpload, patchAvatar]);

  /** Remove avatar — PATCH with null. */
  const handleRemoveAvatar = useCallback(async () => {
    if (!petId) return;
    setAvatarStep("saving");
    setAvatarError(null);
    try {
      await patchAvatar({
        id:   petId,
        data: { avatarKey: null, focusX: null, focusY: null },
      });
    } catch {
      setAvatarError("Could not remove avatar. Please try again.");
      setAvatarStep("sheet");
    }
  }, [petId, patchAvatar]);

  // Pack members — fetched when component mounts; React Query caches the result
  const { data: membersData, isLoading: membersLoading } = useGetPetPackMembers(petId ?? "");

  // ── Pending outgoing co-owner invites (owner view) ────────────────────────
  const { data: pendingInvitesData } = useGetPetCoOwnershipRequests(
    petId ?? "",
    { query: {
      enabled: !!(petId && pet?.viewerOwnsPet),
      queryKey: getGetPetCoOwnershipRequestsQueryKey(petId ?? ""),
    } },
  );
  const pendingInvites = pendingInvitesData?.requests ?? [];

  // ── Co-ownership request check (invitee view) ─────────────────────────────
  // Check whether the viewer has a pending co-ownership request for this pet.
  useEffect(() => {
    if (!petId) return;
    customFetch<{ requests: Array<{ id: string; petId: string; petName: string; inviterUsername: string }> }>(
      "/api/co-ownership-requests/mine",
    )
      .then((data) => {
        const mine = data.requests.find((r: any) => r.petId === petId);
        setMyPendingInvite(mine ?? null);
      })
      .catch(() => {});
  }, [petId]);

  // ── Incoming join requests (owner view) ──────────────────────────────────
  // People who found this pet via search-before-create and asked to co-own it.
  useEffect(() => {
    if (!petId || !pet?.viewerOwnsPet) { setJoinRequests([]); return; }
    customFetch<{ requests: Array<{ id: string; requesterUsername: string; requesterDisplayName?: string | null }> }>(
      `/api/pets/${petId}/co-ownership-join-requests`,
    )
      .then((data) => setJoinRequests(data.requests))
      .catch(() => {});
  }, [petId, pet?.viewerOwnsPet]);

  // ── Approve / decline a join request (owner action) ──────────────────────
  const handleJoinRequest = useCallback(async (requestId: string, action: 'approve' | 'reject') => {
    if (joinActingId) return;
    setJoinActingId(requestId);
    try {
      await customFetch(`/api/co-ownership-requests/${requestId}/${action}`, { method: 'POST' });
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      if (action === 'approve') {
        // New co-owner appears in the Owners list
        queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(petId ?? "") });
      }
    } catch {
      // leave the row in place so the owner can retry
    } finally {
      setJoinActingId(null);
    }
  }, [joinActingId, petId, queryClient]);

  // ── Self-removal handler ─────────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    setLeaveLoading(true);
    setLeaveError(null);
    try {
      await customFetch(`/api/pets/${petId}/co-owners/me`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: getGetMyPetsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() });
      router.replace('/(tabs)/profile');
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Something went wrong.';
      setLeaveError(msg);
      setLeaveConfirm(false);
    } finally {
      setLeaveLoading(false);
    }
  }, [petId, queryClient]);

  // ── Forced revoke handler (primary owner removes a co-owner) ─────────────
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const handleRevoke = useCallback(async (targetUserId: string) => {
    if (revokingId) return;
    setRevokingId(targetUserId);
    try {
      await customFetch(`/api/pets/${petId}/co-owners/${targetUserId}`, { method: 'DELETE' });
      setRevokeConfirmId(null);
      queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(petId ?? "") });
    } catch {
      // Keep the row; primary can retry.
      setRevokeConfirmId(null);
    } finally {
      setRevokingId(null);
    }
  }, [revokingId, petId, queryClient]);

  // ── Co-owner invite handler (owner sends invite by username) ─────────────
  const handleCoOwnerInvite = useCallback(async () => {
    const uname = coOwnerUsername.trim();
    if (!uname) return;
    setCoOwnerSending(true);
    setCoOwnerError(null);
    try {
      await customFetch(`/api/pets/${petId}/co-owners`, {
        method: 'POST',
        body:   JSON.stringify({ username: uname }),
      });
      setCoOwnerSent(true);
      setCoOwnerOpen(false);
      setCoOwnerUsername('');
      queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(petId ?? "") });
      queryClient.invalidateQueries({ queryKey: getGetPetCoOwnershipRequestsQueryKey(petId ?? "") });
    } catch (e: any) {
      if (e?.status === 404 && e?.data?.error === 'User not found') {
        setCoOwnerError(
          `No pshpsh account found for @${uname}. ` +
          `They'll need to join pshpsh first — share your invite link from your profile.`
        );
      } else if (e?.status === 409 && e?.data?.error === 'A pending request for this user already exists') {
        setCoOwnerError(`@${uname} already has a pending invite for this pet.`);
      } else {
        setCoOwnerError(typeof e?.message === 'string' ? e.message : 'Something went wrong.');
      }
    } finally {
      setCoOwnerSending(false);
    }
  }, [coOwnerUsername, petId, queryClient]);

  // ── Cancel a pending outgoing co-owner invite ─────────────────────────────
  const handleCancelInvite = useCallback(async (requestId: string) => {
    if (cancellingId) return;
    setCancellingId(requestId);
    try {
      await customFetch(`/api/pets/${petId}/co-ownership-requests/${requestId}`, {
        method: 'DELETE',
      });
      queryClient.invalidateQueries({ queryKey: getGetPetCoOwnershipRequestsQueryKey(petId ?? "") });
    } catch {
      // silently ignore — the list will stay as-is and the user can retry
    } finally {
      setCancellingId(null);
    }
  }, [cancellingId, petId, queryClient]);

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  // ── Interest follows ───────────────────────────────────────────────────────
  const { speciesMap, breedMap, setSpeciesFollow, setBreedFollow } = useFollowsContext();

  // Mutation pending guards — disable chips while in-flight to prevent double-tap
  const speciesPendingRef = useRef(false);
  const breedPendingRef   = useRef(false);
  const [speciesPending, setSpeciesPending] = useState(false);
  const [breedPending,   setBreedPending]   = useState(false);

  const { mutate: followSpecies }   = useFollowSpecies();
  const { mutate: unfollowSpecies } = useUnfollowSpecies();
  const { mutate: followBreed }     = useFollowBreed();
  const { mutate: unfollowBreed }   = useUnfollowBreed();

  const handleFollowSpecies = useCallback(() => {
    if (!pet?.speciesId || speciesPendingRef.current) return;
    speciesPendingRef.current = true;
    setSpeciesPending(true);

    const id        = pet.speciesId;
    const wasFollow = speciesMap[id] ?? pet.viewerFollowsSpecies ?? false;
    const nextFollow = !wasFollow;

    setSpeciesFollow(id, nextFollow);

    const mutate = nextFollow ? followSpecies : unfollowSpecies;
    mutate(
      { id },
      {
        onSuccess: (result) => {
          setSpeciesFollow(id, result.viewerFollows);
          speciesPendingRef.current = false;
          setSpeciesPending(false);
        },
        onError: () => {
          setSpeciesFollow(id, wasFollow);
          speciesPendingRef.current = false;
          setSpeciesPending(false);
        },
      },
    );
  }, [pet, speciesMap, setSpeciesFollow, followSpecies, unfollowSpecies]);

  const handleFollowBreed = useCallback(() => {
    if (!pet?.breedId || breedPendingRef.current) return;
    breedPendingRef.current = true;
    setBreedPending(true);

    const id        = pet.breedId;
    const wasFollow = breedMap[id] ?? pet.viewerFollowsBreed ?? false;
    const nextFollow = !wasFollow;

    setBreedFollow(id, nextFollow);

    const mutate = nextFollow ? followBreed : unfollowBreed;
    mutate(
      { id },
      {
        onSuccess: (result) => {
          setBreedFollow(id, result.viewerFollows);
          breedPendingRef.current = false;
          setBreedPending(false);
        },
        onError: () => {
          setBreedFollow(id, wasFollow);
          breedPendingRef.current = false;
          setBreedPending(false);
        },
      },
    );
  }, [pet, breedMap, setBreedFollow, followBreed, unfollowBreed]);

  // ── Loading / error states ─────────────────────────────────────────────────
  if (isLoading || (!pet && !isError)) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError || !pet) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/profile')} style={{ marginBottom: 16 }}>
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
          Could not load profile.
        </Text>
      </View>
    );
  }

  // Aggregate reaction totals across all posts
  const totalBoops  = pet.posts.reduce((s, p) => s + p.boopCount,  0);
  const totalTreats = pet.posts.reduce((s, p) => s + p.treatCount, 0);
  const packCount   = localPackCount ?? pet.packCount;

  // Hero rendering — three tiers:
  // (1) avatar set → FocalImage honouring its own focus values
  // (2) no avatar, posts exist → latest post center-cropped (ignoring post focal point)
  // (3) no posts → seed:hero default art
  const hasAvatar = !!pet.avatarUrl;
  // avatarUrl is already an absolute media URL (/api/media/…) — pass via mediaUrl param.
  const heroAvatarSource = hasAvatar
    ? resolveMediaKey("_avatar_", pet.avatarUrl)
    : null;
  const heroPostSource = (!hasAvatar && pet.posts.length > 0)
    ? resolveMediaKey(pet.posts[0].mediaKey, pet.posts[0].mediaUrl)
    : null;
  const heroSeedSource = (!hasAvatar && pet.posts.length === 0)
    ? resolveMediaKey("seed:hero")
    : null;

  // True when the open post is currently archived (drives Archive ↔ Unarchive label)
  const isSelectedPostArchived = !!selectedPost?.archivedAt;

  const handlePackSuccess = (result: PackResult) => {
    setLocalPackCount(result.packCount);
  };

  // Derive current follow state (context wins over server initial value)
  const speciesFollowed = pet.speciesId
    ? (speciesMap[pet.speciesId] ?? pet.viewerFollowsSpecies ?? false)
    : null;
  const breedFollowed = pet.breedId
    ? (breedMap[pet.breedId] ?? pet.viewerFollowsBreed ?? false)
    : null;

  // Show legacy plain text if pet has no catalogue FKs
  const hasChips = pet.speciesId != null || pet.breedId != null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + (Platform.OS === "web" ? 84 : 100),
        }}
      >
        {/* ── Hero ── */}
        <View style={styles.heroWrapper}>
          {/* Tier 1: avatar with focal point */}
          {hasAvatar && heroAvatarSource && (
            <FocalImage
              source={heroAvatarSource}
              style={{ width: "100%", height: HERO_HEIGHT } as any}
              cropX={pet.avatarCropX ?? null}
              cropY={pet.avatarCropY ?? null}
              cropW={pet.avatarCropW ?? null}
              cropH={pet.avatarCropH ?? null}
              focusX={pet.avatarFocusX ?? 0.5}
              focusY={pet.avatarFocusY ?? 0.5}
            />
          )}
          {/* Tier 2: latest post, center-cropped */}
          {!hasAvatar && heroPostSource && (
            <MediaImage
              source={heroPostSource}
              style={[styles.heroImage, { height: HERO_HEIGHT }]}
              resizeMode="cover"
            />
          )}
          {/* Tier 3: seed art */}
          {!hasAvatar && !heroPostSource && heroSeedSource && (
            <MediaImage
              source={heroSeedSource}
              style={[styles.heroImage, { height: HERO_HEIGHT }]}
              resizeMode="cover"
            />
          )}

          <LinearGradient
            colors={["transparent", colors.background]}
            locations={[0.55, 1]}
            style={styles.heroGradient}
          />
          <TouchableOpacity
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/profile')}
            style={[
              styles.backBtn,
              { top: topInset + 8, backgroundColor: "rgba(6,11,16,0.5)" },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color="#F0F4F8" />
          </TouchableOpacity>

          {/* Edit photo badge — owner only */}
          {pet.viewerOwnsPet && (
            <TouchableOpacity
              style={styles.editPhotoBadge}
              onPress={() => setAvatarStep("sheet")}
              accessibilityRole="button"
              accessibilityLabel="Edit profile photo"
              activeOpacity={0.8}
            >
              <Camera size={13} color="#F0F4F8" weight="regular" />
              <Text style={styles.editPhotoBadgeText}>Edit photo</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Profile Info ── */}
        <View style={styles.profileSection}>
          <View style={styles.nameRow}>
            <Text style={[styles.petName, { color: colors.foreground }]}>
              {pet.name}
            </Text>
            {/* Edit profile affordance — pencil, any owner */}
            {pet.viewerOwnsPet && (
              <TouchableOpacity
                onPress={() =>
                  router.push({ pathname: '/pet/edit', params: { id: pet.id } })
                }
                style={styles.editProfileBtn}
                accessibilityRole="button"
                accessibilityLabel="Edit pet profile"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.6}
              >
                <PencilSimple size={16} color={colors.mutedForeground} weight="regular" />
              </TouchableOpacity>
            )}
            <AddToPackLink
              petId={pet.id}
              initialInPack={pet.viewerInPack}
              onSuccess={handlePackSuccess}
            />
          </View>

          {/* Species / breed — chips if catalogued, plain text for legacy pets */}
          {hasChips ? (
            <View style={styles.chipsRow}>
              {pet.speciesId != null && speciesFollowed != null && (
                <InterestChip
                  label={pet.species}
                  followed={speciesFollowed}
                  onPress={handleFollowSpecies}
                  disabled={speciesPending}
                />
              )}
              {pet.breedId != null && breedFollowed != null && pet.breed && (
                <InterestChip
                  label={pet.breed}
                  followed={breedFollowed}
                  onPress={handleFollowBreed}
                  disabled={breedPending}
                />
              )}
            </View>
          ) : (
            <Text style={[styles.breed, { color: colors.mutedForeground }]}>
              {pet.breed ?? pet.species}
            </Text>
          )}

          {pet.bio ? (
            <Text style={[styles.bio, { color: colors.foreground }]}>
              {pet.bio}
            </Text>
          ) : null}

          {/* ── Stats ── */}
          <View style={[styles.statsRow, { borderColor: colors.border }]}>
            {/* Pack stat — tappable to view member list */}
            <TouchableOpacity
              onPress={() => setPackMembersOpen(true)}
              activeOpacity={0.7}
              style={styles.stat}
              accessibilityRole="button"
              accessibilityLabel={`Pack — ${packCount} members`}
            >
              <PawStatIcon size={16} color={colors.primary} />
              <Text style={[styles.statValue, { color: colors.foreground, marginTop: 4 }]}>
                {formatCount(packCount)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Pack</Text>
            </TouchableOpacity>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.stat}>
              <Heart size={16} color={colors.accent} weight="regular" style={{ marginBottom: 4 }} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {formatCount(totalBoops)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Boops</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.stat}>
              <Star size={16} color="#F4C542" weight="regular" style={{ marginBottom: 4 }} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {formatCount(totalTreats)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Treats</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.stat}>
              <SquaresFour size={16} color={colors.mutedForeground} weight="regular" style={{ marginBottom: 4 }} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {pet.posts.length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Posts</Text>
            </View>
          </View>
        </View>

        {/* ── Block owner whisper — non-owners only ── */}
        {!pet.viewerOwnsPet && (
          <BlockOwnerWhisper
            ownerId={(pet as unknown as { ownerId?: string }).ownerId}
            colors={colors}
          />
        )}

        {/* ── Pending co-owner invite banner — shown to the invitee ── */}
        {myPendingInvite && (
          <View style={[styles.coOwnerBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.coOwnerBannerText, { color: colors.foreground }]}>
              {myPendingInvite.inviterUsername} wants to share {pet.name} with you.
            </Text>
            <Text style={[styles.coOwnerBannerDisclosure, { color: colors.mutedForeground }]}>
              accepting means you'll be able to post, edit, or delete posts for this pet — and the primary owner can remove your access at any time. your posts will stay on the pet's profile even if that happens.
            </Text>
            <View style={styles.coOwnerBannerActions}>
              <TouchableOpacity
                onPress={async () => {
                  if (inviteActing) return;
                  setInviteActing(true);
                  try {
                    await customFetch(`/api/co-ownership-requests/${myPendingInvite.id}/decline`, { method: "POST" });
                    setMyPendingInvite(null);
                  } catch { } finally { setInviteActing(false); }
                }}
                disabled={inviteActing}
                style={[styles.coOwnerBannerBtn, { borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel="Decline co-owner invite"
              >
                <Text style={[styles.coOwnerBannerBtnText, { color: colors.mutedForeground }]}>decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  if (inviteActing) return;
                  setInviteActing(true);
                  try {
                    await customFetch(`/api/co-ownership-requests/${myPendingInvite.id}/accept`, { method: "POST" });
                    setMyPendingInvite(null);
                    queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(petId ?? "") });
                    queryClient.invalidateQueries({ queryKey: getGetMyPetsQueryKey() });
                  } catch { } finally { setInviteActing(false); }
                }}
                disabled={inviteActing}
                style={[styles.coOwnerBannerBtn, { borderColor: colors.primary }]}
                accessibilityRole="button"
                accessibilityLabel="Accept co-owner invite"
              >
                <Text style={[styles.coOwnerBannerBtnText, { color: colors.primary }]}>accept</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Owners section — always visible, prominent ── */}
        {(() => {
          const owners = (pet as any).owners as Array<{ userId: string; username: string; displayName?: string | null }> | undefined;
          if (!owners || owners.length === 0) return null;
          return (
            <View style={[styles.ownersSection, { borderColor: colors.border }]}>
              {/* Header row: label + "+ add owner" action */}
              <View style={styles.ownersHeaderRow}>
                <Text style={[styles.ownersSectionLabel, { color: colors.mutedForeground }]}>
                  Owners
                </Text>
                {pet.viewerOwnsPet && !coOwnerSent && !coOwnerOpen && (
                  <TouchableOpacity
                    onPress={() => { setCoOwnerOpen(true); setCoOwnerError(null); setCoOwnerUsername(''); }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel="Add a co-owner"
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.ownersAddBtn, { color: colors.primary }]}>
                      + add owner
                    </Text>
                  </TouchableOpacity>
                )}
                {pet.viewerOwnsPet && coOwnerSent && (
                  <Text style={[styles.ownersAddBtn, { color: colors.mutedForeground }]}>
                    invite sent ✓
                  </Text>
                )}
              </View>

              {/* Owner list */}
              {owners.map((o) => (
                <View key={o.userId} style={styles.ownerRow}>
                  {/* Tappable name → profile (own name → own Profile tab).
                      Report/block live on the profile screen now — the old
                      inline report whisper is gone. */}
                  <TouchableOpacity
                    onPress={() =>
                      o.userId === myUserId
                        ? router.push('/(tabs)/profile')
                        : router.push(`/user/${o.userId}`)
                    }
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${o.displayName?.trim() || 'this member'}'s profile`}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.ownerUsername, { color: colors.foreground }]}>
                      {o.displayName?.trim() || 'a pshpsh member'}
                    </Text>
                  </TouchableOpacity>
                  {/* Forced revoke — visible only to the primary owner, never on their own row */}
                  {(pet as unknown as { ownerId?: string }).ownerId === myUserId &&
                    o.userId !== myUserId && (
                      revokingId === o.userId ? (
                        <ActivityIndicator size="small" color={colors.mutedForeground} />
                      ) : (
                        <TouchableOpacity
                          onPress={() =>
                            revokeConfirmId === o.userId
                              ? handleRevoke(o.userId)
                              : setRevokeConfirmId(o.userId)
                          }
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${o.displayName?.trim() || 'this member'} as a co-owner`}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.ownerPendingCancel,
                              { color: revokeConfirmId === o.userId ? colors.destructive : colors.mutedForeground },
                            ]}
                          >
                            {revokeConfirmId === o.userId ? 'confirm remove?' : 'remove'}
                          </Text>
                        </TouchableOpacity>
                      )
                    )}
                </View>
              ))}

              {/* Pending outgoing invites — shown to owners */}
              {pet.viewerOwnsPet && pendingInvites.length > 0 && (
                <View style={styles.ownerPendingSection}>
                  {pendingInvites.map((inv) => (
                    <View key={inv.id} style={styles.ownerPendingRow}>
                      <Text style={[styles.ownerPendingUsername, { color: colors.foreground }]}>
                        @{inv.inviteeUsername}
                      </Text>
                      <Text style={[styles.ownerPendingBadge, { color: colors.mutedForeground }]}>
                        pending
                      </Text>
                      {cancellingId === inv.id ? (
                        <ActivityIndicator size="small" color={colors.mutedForeground} />
                      ) : (
                        <TouchableOpacity
                          onPress={() => handleCancelInvite(inv.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel={`Cancel invite for @${inv.inviteeUsername}`}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.ownerPendingCancel, { color: colors.mutedForeground }]}>
                            cancel
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* Incoming join requests — shown to owners (any owner may act) */}
              {pet.viewerOwnsPet && joinRequests.length > 0 && (
                <View style={styles.ownerPendingSection}>
                  {joinRequests.map((jr) => (
                    <View key={jr.id} style={styles.ownerPendingRow}>
                      <Text style={[styles.ownerPendingUsername, { color: colors.foreground }]}>
                        {jr.requesterDisplayName?.trim() || 'a pshpsh member'}
                      </Text>
                      <Text style={[styles.ownerPendingBadge, { color: colors.mutedForeground }]}>
                        wants to co-own
                      </Text>
                      {joinActingId === jr.id ? (
                        <ActivityIndicator size="small" color={colors.mutedForeground} />
                      ) : (
                        <>
                          <TouchableOpacity
                            onPress={() => handleJoinRequest(jr.id, 'reject')}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel={`Decline co-ownership request from ${jr.requesterDisplayName?.trim() || 'a pshpsh member'}`}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.ownerPendingCancel, { color: colors.mutedForeground }]}>
                              decline
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleJoinRequest(jr.id, 'approve')}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel={`Accept co-ownership request from ${jr.requesterDisplayName?.trim() || 'a pshpsh member'}`}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.ownerPendingCancel, { color: colors.primary }]}>
                              accept
                            </Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* Leave as owner — shown to owners when the invite form is closed */}
              {pet.viewerOwnsPet && !coOwnerOpen && (
                <View style={styles.ownerLeaveRow}>
                  {leaveError ? (
                    <Text style={[
                      styles.ownerLeaveMessage,
                      { color: leaveError.includes('only owner') ? colors.mutedForeground : colors.destructive },
                    ]}>
                      {leaveError}
                    </Text>
                  ) : null}
                  {leaveConfirm ? (
                    <View style={styles.ownerLeaveConfirmRow}>
                      <TouchableOpacity
                        onPress={() => { setLeaveConfirm(false); setLeaveError(null); }}
                        disabled={leaveLoading}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel leaving"
                      >
                        <Text style={[styles.ownerLeaveCancelText, { color: colors.mutedForeground }]}>
                          cancel
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleLeave}
                        disabled={leaveLoading}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel="Confirm leave as owner"
                      >
                        {leaveLoading
                          ? <ActivityIndicator size="small" color={colors.primary} />
                          : <Text style={[styles.ownerLeaveConfirmText, { color: colors.primary }]}>yes, leave</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => { setLeaveConfirm(true); setLeaveError(null); }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel="Leave as owner"
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.ownerLeaveBtn, { color: colors.primary }]}>
                        leave as owner
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Inline invite form */}
              {pet.viewerOwnsPet && coOwnerOpen && (
                <View style={styles.ownerInviteForm}>
                  {coOwnerError ? (
                    <Text style={[styles.ownerInviteError, { color: colors.destructive }]}>
                      {coOwnerError}
                    </Text>
                  ) : null}
                  <View style={styles.ownerInviteRow}>
                    <TextInput
                      style={[styles.ownerInviteInput, {
                        color: colors.foreground,
                        backgroundColor: colors.secondary,
                        borderColor: colors.border,
                      }]}
                      value={coOwnerUsername}
                      onChangeText={setCoOwnerUsername}
                      placeholder="username"
                      placeholderTextColor={colors.mutedForeground}
                      selectionColor={colors.primary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!coOwnerSending}
                      returnKeyType="send"
                      onSubmitEditing={handleCoOwnerInvite}
                      autoFocus
                    />
                    <TouchableOpacity
                      onPress={handleCoOwnerInvite}
                      disabled={!coOwnerUsername.trim() || coOwnerSending}
                      style={[styles.ownerInviteSendBtn, {
                        backgroundColor: colors.primary,
                        opacity: (!coOwnerUsername.trim() || coOwnerSending) ? 0.45 : 1,
                      }]}
                      accessibilityRole="button"
                      accessibilityLabel="Send invite"
                    >
                      {coOwnerSending
                        ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                        : <Text style={[styles.ownerInviteSendText, { color: colors.primaryForeground }]}>Send</Text>
                      }
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => { setCoOwnerOpen(false); setCoOwnerUsername(''); setCoOwnerError(null); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                  >
                    <Text style={[styles.ownerInviteCancel, { color: colors.mutedForeground }]}>
                      cancel
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })()}

        {/* ── Grid Divider ── */}
        <View style={[styles.gridDivider, { borderTopColor: colors.border }]} />

        {/* ── Post Grid ── */}
        <View style={styles.grid}>
          {pet.posts.map((post) => (
            <TouchableOpacity
              key={post.id}
              onPress={() => setSelectedPostId(post.id)}
              activeOpacity={0.85}
              style={[styles.gridItem, { width: gridItemSize, height: gridItemSize }]}
              accessibilityRole="button"
              accessibilityLabel={`View post: ${post.caption ?? ""}`}
            >
              <MediaImage
                source={resolveMediaKey(post.mediaKey, post.mediaUrl)}
                style={styles.gridImage}
                resizeMode="cover"
              />
              {/* Owner sees "hidden by moderation" overlay on their admin-hidden posts */}
              {pet.viewerOwnsPet && !!(post as unknown as { hiddenByAdmin?: boolean }).hiddenByAdmin && (
                <View style={styles.hiddenOverlay}>
                  <Text style={styles.hiddenOverlayText}>hidden</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Archived Section — owner only, hidden when empty ─────────── */}
        {pet.archivedPosts && pet.archivedPosts.length > 0 && (
          <>
            <TouchableOpacity
              onPress={() => setArchivedExpanded((v) => !v)}
              style={[styles.archivedHeader, { borderTopColor: colors.border }]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${archivedExpanded ? "Hide" : "Show"} archived posts, ${pet.archivedPosts.length} total`}
            >
              <Ionicons name="archive-outline" size={14} color={colors.mutedForeground} />
              <Text style={[styles.archivedHeaderText, { color: colors.mutedForeground }]}>
                Archived ({pet.archivedPosts.length})
              </Text>
              <Ionicons
                name={archivedExpanded ? "chevron-up" : "chevron-down"}
                size={14}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>
            {archivedExpanded && (
              <View style={styles.grid}>
                {pet.archivedPosts.map((post) => (
                  <TouchableOpacity
                    key={post.id}
                    onPress={() => setSelectedPostId(post.id)}
                    activeOpacity={0.85}
                    style={[styles.gridItem, { width: gridItemSize, height: gridItemSize }]}
                    accessibilityRole="button"
                    accessibilityLabel={`View archived post: ${post.caption ?? ""}`}
                  >
                    <MediaImage
                      source={resolveMediaKey(post.mediaKey, post.mediaUrl)}
                      style={styles.gridImage}
                      resizeMode="cover"
                    />
                    {!!(post as unknown as { hiddenByAdmin?: boolean }).hiddenByAdmin && (
                      <View style={styles.hiddenOverlay}>
                        <Text style={styles.hiddenOverlayText}>hidden</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* ── Pack Members Modal ── */}
      <Modal
        visible={packMembersOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPackMembersOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setPackMembersOpen(false)}
          />
          <View style={[styles.membersSheet, { backgroundColor: colors.card }]}>
            {/* Header */}
            <View style={[styles.membersHeader, { borderBottomColor: colors.border }]}>
              <PawStatIcon size={14} color={colors.primary} />
              <Text style={[styles.membersTitle, { color: colors.foreground }]}>
                Pack · {formatCount(packCount)}
              </Text>
              <TouchableOpacity
                onPress={() => setPackMembersOpen(false)}
                style={styles.membersCloseBtn}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* Content */}
            {membersLoading ? (
              <View style={styles.membersCentered}>
                <ActivityIndicator color={colors.primary} size="small" />
              </View>
            ) : !membersData || membersData.members.length === 0 ? (
              <View style={styles.membersCentered}>
                <Text style={[styles.membersEmpty, { color: colors.mutedForeground }]}>
                  No pack members yet.
                </Text>
              </View>
            ) : (
              <ScrollView
                style={styles.membersList}
                contentContainerStyle={styles.membersListContent}
                showsVerticalScrollIndicator={false}
              >
                {membersData.members.map((m) => (
                  <View
                    key={m.username}
                    style={[styles.memberRow, { borderBottomColor: colors.border }]}
                  >
                    <Text style={[styles.memberUsername, { color: colors.foreground }]}>
                      {m.username}
                    </Text>
                    <Text style={[styles.memberDate, { color: colors.mutedForeground }]}>
                      {new Date(m.joinedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day:   "numeric",
                        year:  "numeric",
                      })}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Avatar CropEditor (full-screen modal, hero-aspect crop window) ── */}
      <Modal
        visible={avatarStep === "framing" && !!avatarUri}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setAvatarStep("sheet")}
      >
        {avatarStep === "framing" && avatarUri && (
          <CropEditor
            uri={avatarUri}
            naturalWidth={avatarNatural.current.width || columnWidth}
            naturalHeight={avatarNatural.current.height || HERO_HEIGHT}
            targetAspect={columnWidth / HERO_HEIGHT}
            title="Set avatar"
            cancelIcon="back"
            onConfirm={handleAvatarFrameConfirm}
            onCancel={() => setAvatarStep("sheet")}
          />
        )}
      </Modal>

      {/* ── Avatar post picker (full-screen grid of all posts) ── */}
      <Modal
        visible={avatarStep === "postPicker"}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setAvatarStep("sheet")}
      >
        <View style={[styles.pickerRoot, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View
            style={[
              styles.pickerHeader,
              { paddingTop: insets.top + 12, borderBottomColor: colors.border },
            ]}
          >
            <TouchableOpacity
              onPress={() => setAvatarStep("sheet")}
              style={styles.pickerBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="close" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
              Choose a post
            </Text>
            <View style={styles.pickerBack} />
          </View>
          {/* Grid */}
          {(() => {
            const allPosts = [
              ...pet.posts,
              ...(pet.archivedPosts ?? []),
            ];
            if (allPosts.length === 0) {
              return (
                <View style={styles.pickerEmpty}>
                  <Text style={[styles.pickerEmptyText, { color: colors.mutedForeground }]}>
                    No posts yet. Take a photo first!
                  </Text>
                </View>
              );
            }
            return (
              <ScrollView contentContainerStyle={styles.pickerGrid}>
                {allPosts.map((post) => (
                  <TouchableOpacity
                    key={post.id}
                    style={[styles.pickerItem, { width: gridItemSize, height: gridItemSize }]}
                    activeOpacity={0.75}
                    onPress={() => handlePickFromPost(post as FeedPost)}
                    accessibilityRole="button"
                    accessibilityLabel={`Use photo from ${new Date(post.createdAt).toLocaleDateString()}`}
                  >
                    <MediaImage
                      source={resolveMediaKey(post.mediaKey, post.mediaUrl)}
                      style={styles.pickerItemImage}
                      resizeMode="cover"
                    />
                    {!!post.archivedAt && (
                      <View style={styles.pickerArchivedBadge}>
                        <Ionicons name="archive" size={10} color="#F0F4F8" />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            );
          })()}
        </View>
      </Modal>

      {/* ── Avatar action sheet ── */}
      <Modal
        visible={avatarStep === "sheet" || avatarStep === "saving" || avatarStep === "compressing"}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (avatarStep !== "saving" && avatarStep !== "compressing") {
            setAvatarStep("idle");
            setAvatarError(null);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (avatarStep !== "saving" && avatarStep !== "compressing") {
                setAvatarStep("idle");
                setAvatarError(null);
              }
            }}
          />
          <View style={[styles.avatarSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 12 }]}>
            <Text style={[styles.avatarSheetTitle, { color: colors.foreground }]}>
              Profile photo
            </Text>
            {avatarError && (
              <Text style={styles.avatarSheetError}>{avatarError}</Text>
            )}
            {(avatarStep === "saving" || avatarStep === "compressing") ? (
              <View style={styles.avatarSheetLoader}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.avatarSheetLoaderText, { color: colors.mutedForeground }]}>
                  {avatarStep === "compressing" ? "Processing…" : "Saving…"}
                </Text>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.avatarSheetOption}
                  onPress={() => setAvatarStep("postPicker")}
                  accessibilityRole="button"
                >
                  <Ionicons name="images-outline" size={18} color={colors.foreground} />
                  <Text style={[styles.avatarSheetOptionText, { color: colors.foreground }]}>
                    Choose from posts
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.avatarSheetOption}
                  onPress={() => { setAvatarStep("idle"); handleAvatarCamera(); }}
                  accessibilityRole="button"
                >
                  <Ionicons name="camera-outline" size={18} color={colors.foreground} />
                  <Text style={[styles.avatarSheetOptionText, { color: colors.foreground }]}>
                    Take a photo
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.avatarSheetOption}
                  onPress={() => { setAvatarStep("idle"); handleAvatarLibrary(); }}
                  accessibilityRole="button"
                >
                  <Ionicons name="image-outline" size={18} color={colors.foreground} />
                  <Text style={[styles.avatarSheetOptionText, { color: colors.foreground }]}>
                    Choose from library
                  </Text>
                </TouchableOpacity>
                {pet.avatarUrl && (
                  <TouchableOpacity
                    style={styles.avatarSheetOption}
                    onPress={handleRemoveAvatar}
                    accessibilityRole="button"
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                    <Text style={[styles.avatarSheetOptionText, { color: colors.destructive }]}>
                      Remove photo
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.avatarSheetOption, styles.avatarSheetCancel]}
                  onPress={() => { setAvatarStep("idle"); setAvatarError(null); }}
                  accessibilityRole="button"
                >
                  <Text style={[styles.avatarSheetOptionText, { color: colors.mutedForeground }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Post Detail Modal ── */}
      <Modal
        visible={!!selectedPostId}
        animationType="fade"
        transparent
        onRequestClose={closePostModal}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
        <Pressable style={styles.modalOverlay} onPress={closePostModal}>
          {/* Inner Pressable stops taps on the card from bubbling to the backdrop dismiss handler. */}
          <Pressable style={[styles.modalContent, { width: columnWidth - 32 }]} onPress={() => {}}>
            {selectedPost && (
              <>
                <MediaImage
                  key={selectedPostId ?? undefined}
                  source={resolveMediaKey(selectedPost.mediaKey, selectedPost.mediaUrl)}
                  style={[styles.modalImage, { height: columnWidth - 32 }]}
                  resizeMode="contain"
                />
                <View style={[styles.modalCaption, { backgroundColor: colors.card }]}>
                  <Text style={[styles.modalPetName, { color: colors.primary }]}>
                    {pet.name}
                  </Text>
                  <Text style={[styles.modalCaptionText, { color: colors.foreground }]}>
                    {selectedPost.caption ?? ""}
                  </Text>
                </View>

                {/* Edit & delete affordances — visible to the original poster or primary owner */}
                {(selectedPost as any).viewerCanManagePost && (
                  isEditMode ? (
                    /* ── Edit form ──────────────────────────────────────────── */
                    <View
                      style={[
                        styles.modalEditSection,
                        { backgroundColor: colors.card, borderTopColor: colors.border },
                      ]}
                    >
                      <TextInput
                        style={[
                          styles.modalEditInput,
                          {
                            backgroundColor: colors.secondary,
                            borderColor: colors.border,
                            color: colors.foreground,
                          },
                        ]}
                        value={draftCaption}
                        onChangeText={setDraftCaption}
                        placeholder="Say something about your pet… (optional)"
                        placeholderTextColor={colors.mutedForeground}
                        selectionColor={colors.primary}
                        multiline
                        returnKeyType="done"
                        blurOnSubmit
                        maxLength={280}
                      />
                      {/* Nursery toggle */}
                      <Pressable
                        style={[styles.modalToggleRow, { borderTopColor: colors.border }]}
                        onPress={() => setDraftIsNursery((v) => !v)}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: draftIsNursery }}
                        accessibilityLabel="Nursery post"
                      >
                        <View style={styles.modalToggleInfo}>
                          <Text style={[styles.modalToggleLabel, { color: colors.foreground }]}>
                            Nursery
                          </Text>
                          <Text style={[styles.modalToggleSub, { color: colors.mutedForeground }]}>
                            Mark as a hatchling or baby post
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.modalTrack,
                            { backgroundColor: draftIsNursery ? colors.primary : colors.border },
                          ]}
                        >
                          <View style={[styles.modalThumb, draftIsNursery && styles.modalThumbOn]} />
                        </View>
                      </Pressable>
                      {/* ── Pet tags section ──────────────────────────────── */}
                      <View style={[styles.modalTagSection, { borderTopColor: colors.border }]}>
                        <Text style={[styles.modalTagLabel, { color: colors.mutedForeground }]}>
                          Tagged pets
                        </Text>

                        {/* Currently tagged — poster can remove any, whisper style */}
                        {((selectedPost as any).taggedPets ?? []).map((tp: any) => (
                          <View key={tp.id} style={styles.editTagRow}>
                            <Text style={[styles.editTagName, { color: colors.foreground }]}>
                              {tp.name}
                            </Text>
                            {((selectedPost as any).taggedPets ?? []).length > 1 && (
                              <TouchableOpacity
                                onPress={() => handleEditRemoveTag(tp.id)}
                                disabled={!!editRemovingId}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              >
                                {editRemovingId === tp.id ? (
                                  <ActivityIndicator
                                    size="small"
                                    color={colors.mutedForeground}
                                    style={{ transform: [{ scale: 0.55 }] }}
                                  />
                                ) : (
                                  <Text style={[styles.editTagRemove, { color: colors.mutedForeground }]}>
                                    remove
                                  </Text>
                                )}
                              </TouchableOpacity>
                            )}
                          </View>
                        ))}

                        {/* Own pets not yet tagged — tap to add instantly */}
                        {editableOwnPets.length > 0 && (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={styles.editTagScroll}
                            keyboardShouldPersistTaps="handled"
                          >
                            {editableOwnPets.map((p) => (
                              <TouchableOpacity
                                key={p.id}
                                style={[
                                  styles.editTagAddChip,
                                  { backgroundColor: colors.secondary, borderColor: colors.border },
                                ]}
                                onPress={() => handleEditAddTag(p.id)}
                                disabled={!!editAddingId}
                                activeOpacity={0.7}
                              >
                                {editAddingId === p.id ? (
                                  <ActivityIndicator size="small" color={colors.primary} />
                                ) : (
                                  <Text style={[styles.editTagChipText, { color: colors.foreground }]}>
                                    + {p.name}
                                  </Text>
                                )}
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        )}

                        {/* Search for another user's pet — same pattern as compose */}
                        <TextInput
                          style={[
                            styles.editTagSearchInput,
                            {
                              backgroundColor: colors.secondary,
                              borderColor: colors.border,
                              color: colors.foreground,
                            },
                          ]}
                          value={editTagSearch}
                          onChangeText={setEditTagSearch}
                          placeholder="Search to tag another pet…"
                          placeholderTextColor={colors.mutedForeground}
                          autoCapitalize="none"
                          returnKeyType="search"
                        />
                        {editTagSearchResults.length > 0 && (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={styles.editTagScroll}
                            keyboardShouldPersistTaps="handled"
                          >
                            {editTagSearchResults.map((r) => (
                              <TouchableOpacity
                                key={r.id}
                                style={[
                                  styles.editTagAddChip,
                                  { backgroundColor: colors.secondary, borderColor: colors.border },
                                ]}
                                onPress={() => handleEditAddTag(r.id)}
                                disabled={!!editAddingId}
                                activeOpacity={0.7}
                              >
                                {editAddingId === r.id ? (
                                  <ActivityIndicator size="small" color={colors.primary} />
                                ) : (
                                  <>
                                    <Text style={[styles.editTagChipText, { color: colors.foreground }]}>
                                      {r.name}
                                    </Text>
                                    <Text style={[styles.editTagChipOwner, { color: colors.mutedForeground }]}>
                                      @{r.ownerUsername}
                                    </Text>
                                  </>
                                )}
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        )}
                      </View>

                      {/* Cancel / Save */}
                      <View style={[styles.modalConfirmButtons, styles.modalEditActions]}>
                        <TouchableOpacity
                          onPress={() => setIsEditMode(false)}
                          disabled={isSaving}
                          style={[styles.modalCancelBtn, { borderColor: colors.border }]}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel="Cancel editing"
                        >
                          <Text style={[styles.modalCancelText, { color: colors.mutedForeground }]}>
                            Cancel
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() =>
                            selectedPostId &&
                            doEdit({
                              id: selectedPostId,
                              data: {
                                caption: draftCaption.trim() || null,
                                isNursery: draftIsNursery,
                              },
                            })
                          }
                          disabled={isSaving}
                          style={[styles.modalDeleteBtn, { borderColor: colors.primary }]}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel="Save changes"
                        >
                          {isSaving ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                          ) : (
                            <Text style={[styles.modalDeleteBtnText, { color: colors.primary }]}>
                              Save
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      {/* ── Edit row ────────────────────────────────────────── */}
                      <View
                        style={[
                          styles.modalDeleteSection,
                          { backgroundColor: colors.card, borderTopColor: colors.border },
                        ]}
                      >
                        <TouchableOpacity
                          onPress={() => {
                            setDeleteConfirm(false);    // mutually exclusive
                            setArchiveConfirm(false);   // mutually exclusive
                            setDraftCaption(selectedPost.caption ?? "");
                            setDraftIsNursery(selectedPost.isNursery);
                            setIsEditMode(true);
                          }}
                          style={styles.modalDeleteRow}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel="Edit this post"
                        >
                          <Ionicons name="pencil-outline" size={14} color={colors.foreground} />
                          <Text style={[styles.modalDeleteLabel, { color: colors.foreground }]}>
                            Edit post
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* ── Archive / Unarchive section ───────────────────────── */}
                      <View
                        style={[
                          styles.modalDeleteSection,
                          { backgroundColor: colors.card, borderTopColor: colors.border },
                        ]}
                      >
                        {!archiveConfirm ? (
                          <TouchableOpacity
                            onPress={() => {
                              setIsEditMode(false);
                              setDeleteConfirm(false);
                              setArchiveConfirm(true);
                            }}
                            style={styles.modalDeleteRow}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel={isSelectedPostArchived ? "Restore this post" : "Archive this post"}
                          >
                            <Ionicons name="archive-outline" size={14} color={colors.foreground} />
                            <Text style={[styles.modalDeleteLabel, { color: colors.foreground }]}>
                              {isSelectedPostArchived ? "Unarchive post" : "Archive post"}
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.modalConfirmBlock}>
                            <Text style={[styles.modalConfirmText, { color: colors.foreground }]}>
                              {isSelectedPostArchived
                                ? "Restore this post for everyone?"
                                : "Archive this post? Only you will see it."}
                            </Text>
                            <View style={styles.modalConfirmButtons}>
                              <TouchableOpacity
                                onPress={() => setArchiveConfirm(false)}
                                disabled={isArchiving || isUnarchiving}
                                style={[styles.modalCancelBtn, { borderColor: colors.border }]}
                                activeOpacity={0.7}
                                accessibilityRole="button"
                                accessibilityLabel="Cancel"
                              >
                                <Text style={[styles.modalCancelText, { color: colors.mutedForeground }]}>
                                  Cancel
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => {
                                  if (!selectedPostId) return;
                                  isSelectedPostArchived
                                    ? doUnarchive({ id: selectedPostId })
                                    : doArchive({ id: selectedPostId });
                                }}
                                disabled={isArchiving || isUnarchiving}
                                style={[styles.modalDeleteBtn, { borderColor: colors.foreground }]}
                                activeOpacity={0.7}
                                accessibilityRole="button"
                                accessibilityLabel={isSelectedPostArchived ? "Confirm restore" : "Confirm archive"}
                              >
                                {(isArchiving || isUnarchiving) ? (
                                  <ActivityIndicator size="small" color={colors.foreground} />
                                ) : (
                                  <Text style={[styles.modalDeleteBtnText, { color: colors.foreground }]}>
                                    {isSelectedPostArchived ? "Restore" : "Archive"}
                                  </Text>
                                )}
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>

                      {/* ── Delete section ──────────────────────────────────── */}
                      <View
                        style={[
                          styles.modalDeleteSection,
                          { backgroundColor: colors.card, borderTopColor: colors.border },
                        ]}
                      >
                        {!deleteConfirm ? (
                          <TouchableOpacity
                            onPress={() => {
                              setIsEditMode(false);     // mutually exclusive
                              setArchiveConfirm(false); // mutually exclusive
                              setDeleteConfirm(true);
                            }}
                            style={styles.modalDeleteRow}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel="Delete this post"
                          >
                            <Ionicons name="trash-outline" size={14} color={colors.destructive} />
                            <Text style={[styles.modalDeleteLabel, { color: colors.destructive }]}>
                              Delete post
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.modalConfirmBlock}>
                            <Text style={[styles.modalConfirmText, { color: colors.foreground }]}>
                              Delete this post? This can't be undone.
                            </Text>
                            <View style={styles.modalConfirmButtons}>
                              <TouchableOpacity
                                onPress={() => setDeleteConfirm(false)}
                                disabled={isDeleting}
                                style={[styles.modalCancelBtn, { borderColor: colors.border }]}
                                activeOpacity={0.7}
                                accessibilityRole="button"
                                accessibilityLabel="Cancel"
                              >
                                <Text style={[styles.modalCancelText, { color: colors.mutedForeground }]}>
                                  Cancel
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => selectedPostId && doDelete({ id: selectedPostId })}
                                disabled={isDeleting}
                                style={[styles.modalDeleteBtn, { borderColor: colors.destructive }]}
                                activeOpacity={0.7}
                                accessibilityRole="button"
                                accessibilityLabel="Confirm delete"
                              >
                                {isDeleting ? (
                                  <ActivityIndicator size="small" color={colors.destructive} />
                                ) : (
                                  <Text style={[styles.modalDeleteBtnText, { color: colors.destructive }]}>
                                    Delete
                                  </Text>
                                )}
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>
                    </>
                  )
                )}

                <TouchableOpacity
                  style={[styles.modalCloseBtn, { backgroundColor: "rgba(6,11,16,0.7)" }]}
                  onPress={closePostModal}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={20} color="#F0F4F8" />
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── BlockOwnerWhisper ─────────────────────────────────────────────────────────
// Quiet "block owner" affordance shown on non-owner pet profiles.

function BlockOwnerWhisper({
  ownerId,
  colors,
}: {
  ownerId: string | undefined;
  colors: ReturnType<typeof useColors>;
}) {
  const [blockDone,  setBlockDone]  = useState(false);
  const [blocking,   setBlocking]   = useState(false);

  if (!ownerId) return null;

  const handleBlock = async () => {
    if (blockDone || blocking) return;
    setBlocking(true);
    try {
      await customFetch<{ ok: boolean }>("/api/blocks", {
        method: "POST",
        body:   JSON.stringify({ blockedUserId: ownerId }),
      });
      setBlockDone(true);
    } catch {
      // Silent — this surface is low-stakes utility
    } finally {
      setBlocking(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={handleBlock}
      disabled={blockDone || blocking}
      style={{ alignItems: "center", paddingVertical: 8, marginTop: 4 }}
      accessibilityRole="button"
      accessibilityLabel={blockDone ? "Owner blocked" : "Block this owner"}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Text style={{ color: colors.mutedForeground, fontSize: 12, opacity: 0.4, fontFamily: "Inter_400Regular" }}>
        {blockDone ? "blocked. you won't see each other's posts." : "block owner"}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered:  { alignItems: "center", justifyContent: "center" },
  scroll:    { flex: 1 },
  heroWrapper:  { position: "relative" },
  heroImage:    { width: "100%" },
  heroGradient: { position: "absolute", left: 0, right: 0, bottom: 0, height: 120 },
  backBtn: {
    position: "absolute", left: 14, width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
  },

  // ── Edit photo badge ──────────────────────────────────────────────────────
  editPhotoBadge: {
    position: "absolute",
    bottom: 14,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(6,11,16,0.62)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  editPhotoBadgeText: {
    color: "#F0F4F8",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },

  // ── Avatar action sheet ───────────────────────────────────────────────────
  avatarSheet: {
    width: "100%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    overflow: "hidden",
  },
  avatarSheetTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    letterSpacing: -0.2,
    textAlign: "center",
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  avatarSheetError: {
    color: "#E55",
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  avatarSheetOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  avatarSheetOptionText: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
  },
  avatarSheetCancel: {
    marginTop: 4,
    justifyContent: "center",
  },
  avatarSheetLoader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  avatarSheetLoaderText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },

  // ── Post picker (full-screen grid) ───────────────────────────────────────
  pickerRoot: { flex: 1 },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerBack: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerTitle: {
    flex: 1,
    textAlign: "center",
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  pickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
    padding: 2,
  },
  pickerItem: {
    // width/height set inline from gridItemSize — correct inside 430-px web column.
    position: "relative",
  },
  pickerItemImage: {
    width: "100%",
    height: "100%",
  },
  pickerArchivedBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 8,
    padding: 3,
  },
  pickerEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  pickerEmptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  profileSection: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 8 },
  nameRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  petName:  { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },
  editProfileBtn: {
    padding: 6,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  breed:    { fontSize: 14, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
  bio:      { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  statsRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stat:       { flex: 1, alignItems: "center" },
  statValue:  { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel:  {
    fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.5,
    textTransform: "uppercase", marginTop: 2,
  },
  statDivider: { width: StyleSheet.hairlineWidth, height: 36 },
  gridDivider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8 },
  grid:        { flexDirection: "row", flexWrap: "wrap", gap: 2 },
  archivedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  archivedHeaderText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.2,
  },
  gridItem:    { /* width/height set inline from gridItemSize */ },
  gridImage:   { width: "100%", height: "100%" },
  // "hidden by moderation" overlay shown to owners on their admin-hidden posts
  hiddenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems:      "center",
    justifyContent:  "center",
  },
  hiddenOverlayText: {
    fontFamily:    "Inter_600SemiBold",
    fontSize:      11,
    color:         "#FFFFFF",
    letterSpacing: 0.2,
    textTransform: "uppercase" as const,
    opacity:       0.9,
  },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end", alignItems: "center",
  },

  // Pack members sheet (slides up from bottom)
  membersSheet: {
    width: "100%",
    maxHeight: "60%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  membersHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  membersTitle: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    letterSpacing: -0.2,
  },
  membersCloseBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  membersCentered: {
    paddingVertical: 40,
    alignItems: "center",
  },
  membersEmpty: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  membersList: { flex: 1 },
  membersListContent: { paddingBottom: 40 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberUsername: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
  },
  memberDate: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },

  // Post detail modal
  modalContent: { /* width set inline from columnWidth */ borderRadius: 16, overflow: "hidden" },

  // Delete affordance inside the post modal
  modalDeleteSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modalDeleteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modalDeleteLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  modalConfirmBlock: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  modalConfirmText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
  },
  modalConfirmButtons: {
    flexDirection: "row",
    gap: 8,
  },
  modalCancelBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  modalDeleteBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 37,
  },
  modalDeleteBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  modalImage:       { width: "100%", /* height set inline from columnWidth */ },
  modalCaption:     { padding: 16, gap: 4 },
  modalPetName:     { fontSize: 13, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 },
  modalCaptionText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  modalCloseBtn: {
    position: "absolute", top: 12, right: 12,
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },

  // ── Edit mode ──────────────────────────────────────────────────────────────
  modalEditSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  modalEditInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 13 : 10,
    fontFamily: "Inter_400Regular",
    fontSize: 16, // ≥16 prevents iOS Safari auto-zoom on focus
    minHeight: 72,
    textAlignVertical: "top",
  },
  modalEditActions: {
    paddingBottom: 14,
  },
  modalToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 14,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modalToggleInfo: { flex: 1, marginRight: 12 },
  modalToggleLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  modalToggleSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  modalTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  modalThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
  },
  modalThumbOn: {
    alignSelf: "flex-end",
  },

  // ── Co-owner invite banner (invitee view) ─────────────────────────────────
  coOwnerBanner: {
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  coOwnerBannerText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  coOwnerBannerDisclosure: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
    opacity: 0.75,
  },
  coOwnerBannerActions: {
    flexDirection: "row",
    gap: 8,
  },
  coOwnerBannerBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  coOwnerBannerBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },

  // ── Sent pending invites (primary owner view) ─────────────────────────────
  coOwnerSentList: {
    marginHorizontal: 20,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  coOwnerSentHeader: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  coOwnerSentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  coOwnerSentUsername: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  coOwnerSentRevoke: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    opacity: 0.5,
  },

  // ── Owners section (prominent, always visible on pet profile) ─────────────
  ownersSection: {
    marginHorizontal: 20,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 6,
  },
  ownersHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  ownersSectionLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  ownerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  ownersAddBtn: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  ownerUsername: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
  },
  ownerPendingSection: {
    gap: 4,
    marginTop: 2,
  },
  ownerPendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 2,
  },
  ownerPendingUsername: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    flex: 1,
  },
  ownerPendingBadge: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    opacity: 0.7,
  },
  ownerPendingCancel: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    opacity: 0.8,
  },

  ownerInviteForm: {
    marginTop: 8,
    gap: 8,
  },
  ownerInviteError: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
  ownerInviteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ownerInviteInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 11 : 8,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
  },
  ownerInviteSendBtn: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 11 : 9,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 60,
  },
  ownerInviteSendText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  ownerInviteCancel: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    alignSelf: "flex-start",
    opacity: 0.7,
  },

  // ── Leave as owner ────────────────────────────────────────────────────────
  ownerLeaveRow: {
    marginTop: 4,
    gap: 6,
  },
  ownerLeaveBtn: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  ownerLeaveMessage: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
  ownerLeaveConfirmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  ownerLeaveConfirmText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  ownerLeaveCancelText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },

  // ── Edit-post pet-tag section ──────────────────────────────────────────────
  modalTagSection: {
    borderTopWidth:   StyleSheet.hairlineWidth,
    paddingTop:       12,
    paddingHorizontal: 14,
    paddingBottom:    8,
    gap:              8,
  },
  modalTagLabel: {
    fontFamily: "Inter_400Regular",
    fontSize:   11,
    opacity:    0.6,
    textTransform: "uppercase",
    letterSpacing:  0.5,
  },
  editTagRow: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  editTagName: {
    fontFamily: "Inter_500Medium",
    fontSize:   14,
  },
  // Matches reportWhisper / removeTagWhisper — barely-there typographic action
  editTagRemove: {
    fontFamily: "Inter_400Regular",
    fontSize:   11,
    opacity:    0.35,
  },
  editTagScroll: {
    marginTop: 2,
  },
  editTagAddChip: {
    borderWidth:   1,
    borderRadius:  20,
    paddingHorizontal: 12,
    paddingVertical:    7,
    marginRight:   8,
    alignItems:    "center",
    minWidth:      60,
    minHeight:     34,
    justifyContent: "center",
  },
  editTagChipText: {
    fontFamily: "Inter_500Medium",
    fontSize:   13,
  },
  editTagChipOwner: {
    fontFamily: "Inter_400Regular",
    fontSize:   11,
    marginTop:  1,
  },
  editTagSearchInput: {
    borderWidth:      1,
    borderRadius:     8,
    paddingHorizontal: 12,
    paddingVertical:   8,
    fontFamily:       "Inter_400Regular",
    fontSize:         14,
    marginTop:        4,
  },
});
