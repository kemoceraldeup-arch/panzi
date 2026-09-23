// src/screens/ProfileSurveyScreen.tsx
//
// Collected once, right after account creation (email or guest).
// This is the seed data for the future AI recipe engine — dietary
// preferences let it filter suggestions, and the meal-plan opt-in decides
// whether it proactively pushes plans vs. only responding when asked.

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import Text from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../config/firebaseClient';
import { COMMON_ALLERGENS, COMMON_DIETS, saveSurvey } from '../services/profile';
import MultiSelectDropdown from '../components/profile/MultiSelectDropdown';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import { type } from '../theme/typography';

const NAME_MAX_LENGTH = 40;
// Letters, numbers, and a few common username punctuation marks — no spaces,
// so this can't be quietly filled in with someone's full legal name.
const NAME_PATTERN = /^[\p{L}\p{N}_.-]+$/u;

function getNameError(value: string): string | null {
  if (!value) return 'Enter a username.';
  if (/\s/.test(value)) return 'Usernames can\'t contain spaces.';
  if (value.length < 2) return 'Username is too short.';
  if (value.length > NAME_MAX_LENGTH) return `Keep it under ${NAME_MAX_LENGTH} characters.`;
  if (!NAME_PATTERN.test(value)) return 'Only letters, numbers, and _ . - are allowed.';
  return null;
}

type Props = {
  onContinue: () => void;
};

export default function ProfileSurveyScreen({ onContinue }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [dietary, setDietary] = useState<string[]>([]);
  const [mealPlanOptIn, setMealPlanOptIn] = useState(true);
  // A picked list rather than one free-text field — see
  // MultiSelectDropdown below. Still stored/sent as the same comma-joined
  // string the backend has always expected (services/profile.ts's
  // saveSurvey), so this is a client-side input change only, nothing
  // server-side had to move.
  const [allergies, setAllergies] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Set by a Continue press that could not go through. Until then a field the
  // user has not reached yet is not "wrong" — it is unanswered, and colouring
  // it red on arrival would tell them off for a form they have barely started.
  const [submitted, setSubmitted] = useState(false);

  const nameError = getNameError(name);

  // Dietary preferences and allergies are both optional — an empty selection
  // just means "no preference/allergy stated," a real, valid answer, not an
  // unanswered question the user needs to be stopped and told about.
  const canContinue = !nameError;

  // Each field turns red once it has been left, or once Continue has been
  // pressed and it is the reason nothing happened.
  const showNameError = (nameTouched || submitted) && !!nameError;

  function toggleDietary(option: string) {
    setDietary((prev) =>
      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
    );
  }

  function addAllergy(value: string) {
    setAllergies((prev) => (prev.includes(value) ? prev : [...prev, value].slice(0, 20)));
  }

  function removeAllergy(value: string) {
    setAllergies((prev) => prev.filter((a) => a !== value));
  }

  async function handleContinue() {
    if (!canContinue) {
      // The button stays pressable on purpose. A disabled button is silent
      // about which field is holding it up, and the user is left comparing
      // what they typed against a control that will not react at all.
      setSubmitted(true);
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert('Something went wrong', "You're not signed in — try again from the previous screen.");
      return;
    }
    setSaving(true);
    try {
      const savePromise = saveSurvey(uid, {
        name: name.trim(),
        dietary,
        // Comma-joined for the same reason ProfileScreen's saveAllergies
        // already is (see services/profile.ts) — the server, and
        // parseAllergies on the way back out, both expect one string.
        allergies: allergies.join(', '),
        mealPlanOptIn,
      });
      // Kept from the Firestore version, for a different reason: apiFetch
      // checks that the server is reachable before the real request, but a
      // server that accepts the connection and then stalls would still leave
      // this button spinning forever.
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Taking too long — check your connection and try again.')), 10000)
      );
      await Promise.race([savePromise, timeout]);
      onContinue();
    } catch (err: any) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View>
              <View style={styles.header}>
                <Text style={styles.title}>Tell Panzi about you.</Text>
                <Text style={styles.description}>
                  This shapes every recipe suggestion — what fits your diet, how much to cook, and what to flag before it goes bad.
                </Text>
              </View>

              <View style={styles.body}>
                <Text style={styles.label}>Username</Text>
                <TextInput
                  style={[styles.input, showNameError && styles.inputError]}
                  placeholder="Pick a username"
                  placeholderTextColor={colors.textSecondary}
                  value={name}
                  onChangeText={(text) => setName(text)}
                  onBlur={() => setNameTouched(true)}
                  maxLength={NAME_MAX_LENGTH}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                />
                {showNameError && <Text style={styles.errorText}>{nameError}</Text>}

                <Text style={styles.label}>Any dietary preferences? (optional)</Text>
                <MultiSelectDropdown
                  placeholder="Select dietary preferences"
                  options={COMMON_DIETS}
                  selected={dietary}
                  onToggle={toggleDietary}
                />

                {/* A dropdown rather than free text — picking from a known
                    list cuts out the typo/inconsistent-spelling error a
                    plain field invited ("nut" vs "nuts" vs "peanut") at the
                    source, instead of trying to clean it up later. */}
                <Text style={styles.label}>Allergies or foods to avoid (optional)</Text>
                <MultiSelectDropdown
                  placeholder="Select allergies"
                  options={COMMON_ALLERGENS}
                  selected={allergies}
                  onToggle={(option) =>
                    allergies.includes(option) ? removeAllergy(option) : addAllergy(option)
                  }
                />

                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Send me weekly meal plan ideas</Text>
                  <Switch
                    value={mealPlanOptIn}
                    onValueChange={setMealPlanOptIn}
                    // Same fix as the Dark mode switch on the Profile tab —
                    // see the note there. 1.24:1 against the card was invisible.
                    trackColor={{ true: colors.primary, false: colors.tabInactive }}
                    ios_backgroundColor={colors.tabInactive}
                    thumbColor={colors.onAccent}
                  />
                </View>
              </View>

              <View style={styles.footer}>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleContinue}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Continue</Text>
                  )}
                </TouchableOpacity>
                {submitted && !canContinue && (
                  <Text style={styles.hintText}>Fill in the fields marked in red above.</Text>
                )}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 0,
  },
  header: {
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
  },
  title: {
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.sm,
  },
  description: {
    fontSize: type.bodySmall.fontSize,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  body: {
    paddingHorizontal: space.xxl,
    paddingTop: space.xs,
  },
  label: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.sm2,
    marginTop: space.xl,
  },
  input: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    backgroundColor: colors.card,
    paddingHorizontal: space.lg,
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.error,
    marginTop: space.xs2,
  },
  toggleRow: {
    marginTop: space.xl2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 18,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
    marginRight: space.md,
  },
  footer: {
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  primaryButton: {
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.onAccent,
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
  },
  hintText: {
    textAlign: 'center',
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
    marginTop: space.sm2,
  },
}));